import express from 'express';
import Stripe from 'stripe';
import { supabase } from '../config/database.js';
import { authMiddleware } from '../config/auth.js';
import { SUBJECT_PRICES_MYR, ALL_SUBJECTS, ALWAYS_FREE } from '../config/subjectAccess.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const APP_URL = process.env.APP_URL || 'https://learnova.optimus.com.my';

// GET /api/payment/plans — return plan info for Flutter UI
router.get('/plans', (req, res) => {
  res.json({
    plans: [
      {
        id: 'single',
        name: '1 Subjek',
        description: 'Akses penuh 1 subjek pilihan selama 30 hari',
        price_cents: SUBJECT_PRICES_MYR.single,
        price_display: 'RM15',
        duration_days: 30,
      },
      {
        id: 'bundle3',
        name: '3 Subjek',
        description: 'Pilih mana-mana 3 subjek, jimat lebih',
        price_cents: SUBJECT_PRICES_MYR.bundle3,
        price_display: 'RM35',
        duration_days: 30,
      },
      {
        id: 'bundleAll',
        name: 'Semua Subjek',
        description: 'Akses tanpa had semua 13 subjek SPM',
        price_cents: SUBJECT_PRICES_MYR.bundleAll,
        price_display: 'RM69',
        duration_days: 30,
      },
    ],
    subjects: ALL_SUBJECTS.filter(s => !ALWAYS_FREE.includes(s)),
    always_free: ALWAYS_FREE,
  });
});

// GET /api/payment/my-subjects — return student's current access
router.get('/my-subjects', authMiddleware, async (req, res) => {
  try {
    const { data: access } = await supabase
      .from('subject_access')
      .select('subject, access_type, expires_at, granted_at')
      .eq('student_id', req.user.userId);

    // Check trial mode
    const { data: setting } = await supabase
      .from('platform_settings').select('value').eq('key', 'trial_mode_active').maybeSingle();
    const trialMode = setting?.value === 'true';

    const now = new Date();
    const subjects = (access || []).map(a => ({
      subject: a.subject,
      access_type: trialMode ? 'god_mode' : a.access_type,
      expires_at: a.expires_at,
      granted_at: a.granted_at,
      active: trialMode || !a.expires_at || new Date(a.expires_at) > now,
    }));

    // In trial/god mode return all subjects as active
    if (trialMode) {
      const existing = new Set(subjects.map(s => s.subject));
      for (const sub of ALL_SUBJECTS) {
        if (!existing.has(sub)) {
          subjects.push({ subject: sub, access_type: 'god_mode', expires_at: null, active: true });
        }
      }
    }

    res.json({ subjects, trial_mode: trialMode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/create-checkout — create Stripe checkout session
router.post('/create-checkout', authMiddleware, async (req, res) => {
  try {
    const { plan, subjects = [] } = req.body;
    const plans = {
      single: SUBJECT_PRICES_MYR.single,
      bundle3: SUBJECT_PRICES_MYR.bundle3,
      bundleAll: SUBJECT_PRICES_MYR.bundleAll,
    };
    if (!plans[plan]) return res.status(400).json({ error: 'Invalid plan' });

    const amount = plans[plan];
    const subjectList = plan === 'bundleAll' ? ALL_SUBJECTS.filter(s => !ALWAYS_FREE.includes(s)) : subjects;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'myr',
          product_data: {
            name: plan === 'bundleAll' ? 'Learnova — Semua Subjek' : `Learnova — ${subjectList.join(', ')}`,
            description: '30 hari akses penuh',
          },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${APP_URL}/?payment=success&plan=${plan}`,
      cancel_url: `${APP_URL}/?payment=cancelled`,
      metadata: {
        student_id: req.user.userId,
        plan,
        subjects: JSON.stringify(subjectList),
      },
    });

    // Record pending payment
    await supabase.from('payments').insert({
      student_id: req.user.userId,
      stripe_session_id: session.id,
      amount_cents: amount,
      currency: 'myr',
      subject: subjectList.join(','),
      plan,
      status: 'pending',
      metadata: { subjects: subjectList },
    });

    res.json({ checkout_url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[Payment] create-checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/webhook — Stripe webhook (raw body required)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Payment] Webhook signature failed:', err.message);
    return res.status(400).json({ error: err.message });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { student_id, plan, subjects: subjectsJson } = session.metadata;
    const subjectList = JSON.parse(subjectsJson || '[]');
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();

    try {
      // Grant subject_access for each subject
      const grants = subjectList.map(subject => ({
        student_id,
        subject,
        access_type: 'paid',
        granted_at: new Date().toISOString(),
        expires_at: expiresAt,
        payment_id: null,
      }));
      if (grants.length > 0) {
        await supabase.from('subject_access').upsert(grants, { onConflict: 'student_id,subject' });
      }

      // Update payment record
      await supabase.from('payments')
        .update({ status: 'success', stripe_payment_intent: session.payment_intent, updated_at: new Date().toISOString() })
        .eq('stripe_session_id', session.id);

      console.log(`[Payment] Granted ${subjectList.length} subjects to student ${student_id}`);
    } catch (dbErr) {
      console.error('[Payment] DB update failed:', dbErr.message);
    }
  }

  res.json({ received: true });
});

export default router;
