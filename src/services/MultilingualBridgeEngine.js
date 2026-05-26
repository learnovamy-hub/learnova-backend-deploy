/**
 * MultilingualBridgeEngine
 *
 * Cache-first multilingual snippet service.
 * Lookup → bridge_snippets table (pre-generated, $0 cost).
 * Fallback → Claude Haiku on-demand (rare, auto-saves for future).
 */

export const BRIDGE_LANGUAGES = {
  ta: { name: 'Tamil',    voice_female: 'ta-MY-KaniNeural',     locale: 'ta-MY', phase: 1,
        template: 'Generate a SHORT Tamil explanation (3-4 sentences) for a Malaysian Form 4-5 student. Use simple everyday Malaysian Tamil. Include key term in Tamil if possible.' },
  zh: { name: 'Mandarin', voice_female: 'zh-CN-XiaoxiaoNeural', locale: 'zh-CN', phase: 1,
        template: 'Generate a SHORT Mandarin explanation (3-4 sentences) for a Malaysian Form 4-5 student. Simple vocabulary suitable for a teenager. Include key term in Chinese if possible.' },
  yue:{ name: 'Cantonese',voice_female: 'zh-HK-HiuMaanNeural',  locale: 'zh-HK', phase: 2,
        template: 'Generate a SHORT Cantonese explanation (3-4 sentences) for a Malaysian student.' },
  id: { name: 'Indonesian',voice_female:'id-ID-GadisNeural',     locale: 'id-ID', phase: 2,
        template: 'Generate a SHORT Indonesian explanation (3-4 sentences) for a Malaysian student.' },
};

const ACTIVE_PHASES = [1];

export class MultilingualBridgeEngine {
  constructor(supabase, claude) {
    this.supabase = supabase;
    this.claude   = claude;
  }

  /**
   * Main entry point. Returns snippet text + audio URL from cache,
   * or generates on-demand if cache miss.
   */
  async generateSnippet({ targetLanguage, subject, topic, conceptTitle, currentExplanation, form }) {
    const langConfig = BRIDGE_LANGUAGES[targetLanguage];
    if (!langConfig) return { success: false, message: 'Language not supported' };
    if (!ACTIVE_PHASES.includes(langConfig.phase)) {
      return { success: false, message: `${langConfig.name} support coming soon!` };
    }

    // Step 1: Exact topic match
    const { data: exact } = await this.supabase
      .from('bridge_snippets')
      .select('id, snippet_text, audio_url, concept_title')
      .eq('subject', subject)
      .ilike('topic', `%${topic}%`)
      .eq('language_code', targetLanguage)
      .order('use_count', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (exact) {
      this._bump(exact.id);
      return this._ok(exact, langConfig, topic);
    }

    // Step 2: Subject fallback (pick closest concept title)
    const { data: subjectRows } = await this.supabase
      .from('bridge_snippets')
      .select('id, snippet_text, audio_url, concept_title')
      .eq('subject', subject)
      .eq('language_code', targetLanguage)
      .limit(5);

    if (subjectRows?.length) {
      const best = this._bestMatch(subjectRows, topic, conceptTitle);
      this._bump(best.id);
      return this._ok(best, langConfig, topic);
    }

    // Step 3: On-demand Claude generation (cache miss)
    return this._onDemand({ targetLanguage, langConfig, subject, topic, conceptTitle, currentExplanation, form });
  }

  // ── private ──────────────────────────────────────────────

  _ok(row, langConfig, topic) {
    return {
      success: true,
      snippet: row.snippet_text,
      full_response: `${row.snippet_text}\n\n_(Penjelasan ringkas dalam ${langConfig.name} untuk topik ${topic}. Mari kita teruskan dalam Bahasa Malaysia.)_`,
      language_name: langConfig.name,
      audio_url: row.audio_url || null,
      from_cache: true,
      bridge_mode: true,
    };
  }

  _bestMatch(rows, topic, conceptTitle) {
    const words = `${topic} ${conceptTitle || ''}`.toLowerCase().split(/\s+/);
    let best = rows[0], bestScore = 0;
    for (const r of rows) {
      const score = words.filter(w => (r.concept_title || '').toLowerCase().includes(w)).length;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return best;
  }

  async _bump(id) {
    try { await this.supabase.rpc('increment_bridge_usage', { snippet_id: id }); } catch {}
  }

  async _onDemand({ targetLanguage, langConfig, subject, topic, conceptTitle, currentExplanation, form }) {
    try {
      const prompt = `Generate a SHORT ${langConfig.name} explanation (3-4 sentences max) of this concept for a Malaysian secondary school student.

Subject: ${subject} | Topic: ${topic} | Concept: ${conceptTitle || topic}

Reference (DO NOT copy verbatim):
${(currentExplanation || topic).substring(0, 300)}

${langConfig.template}

Output ONLY the snippet in ${langConfig.name}. No preamble, no labels.`;

      const msg = await this.claude.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = msg.content[0].text.trim();

      // Auto-save so next student gets it free
      await this.supabase.from('bridge_snippets').insert({
        subject, topic,
        concept_title: conceptTitle || topic,
        language_code: targetLanguage,
        language_name: langConfig.name,
        snippet_text: text,
        voice_used: langConfig.voice_female,
        char_count: text.length,
        form: form || 'Form 4',
        generation_model: 'claude-haiku-4-5-20251001',
      }).onConflict('concept_chunk_id,language_code').ignore();

      return {
        success: true,
        snippet: text,
        full_response: `${text}\n\n_(Penjelasan dalam ${langConfig.name}. Mari kita teruskan dalam Bahasa Malaysia.)_`,
        language_name: langConfig.name,
        audio_url: null,
        from_cache: false,
        bridge_mode: true,
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}
