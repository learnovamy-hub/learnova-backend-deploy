/**
 * BM Correction Engine — 4-layer pipeline for fixing YouTube ASR transcripts in Bahasa Malaysia.
 *
 * YouTube's ASR breaks BM multi-syllable words into phonetic fragments because
 * it was trained primarily on English. This engine reconstructs them.
 *
 * Pipeline:
 *   Layer 1 → Phonetic syllable rejoining (regex)
 *   Layer 2 → BM educational lexicon (exact/fuzzy dictionary)
 *   Layer 3 → KOMSAS + SPM BM specific terms
 *   Layer 4 → Claude semantic cleanup (catches anything above missed)
 */

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — ASR Phonetic Patterns
// YouTube splits BM words at syllable boundaries. These patterns rejoin them.
// ─────────────────────────────────────────────────────────────────────────────

const PHONETIC_PATTERNS = [
  // Common BM prefixes split by ASR
  [/\bpe r\s+([a-z])/gi,    'per$1'],
  [/\bpe n\s+([a-z])/gi,    'pen$1'],
  [/\bpe m\s+([a-z])/gi,    'pem$1'],
  [/\bpe ng\s+([a-z])/gi,   'peng$1'],
  [/\bpe ny\s+([a-z])/gi,   'peny$1'],
  [/\bme ng\s+([a-z])/gi,   'meng$1'],
  [/\bme n\s+([a-z])/gi,    'men$1'],
  [/\bme m\s+([a-z])/gi,    'mem$1'],
  [/\bme ny\s+([a-z])/gi,   'meny$1'],
  [/\bdi\s+([a-z])/gi,      'di$1'],
  [/\bter\s+([a-z])/gi,     'ter$1'],
  [/\bber\s+([a-z])/gi,     'ber$1'],
  [/\bke\s+([a-z])/gi,      'ke$1'],

  // Common BM suffixes split by ASR
  [/([a-z])\s+an\b/gi,      '$1an'],
  [/([a-z])\s+kan\b/gi,     '$1kan'],
  [/([a-z])\s+nya\b/gi,     '$1nya'],
  [/([a-z])\s+lah\b/gi,     '$1lah'],
  [/([a-z])\s+kah\b/gi,     '$1kah'],
  [/([a-z])\s+i\b/gi,       '$1i'],

  // Known bad splits: consonant clusters and digraphs
  [/\bng\s+([aeiou])/gi,    'ng$1'],
  [/\bny\s+([aeiou])/gi,    'ny$1'],
  [/\bsy\s+([aeiou])/gi,    'sy$1'],
  [/\bkh\s+([aeiou])/gi,    'kh$1'],
  [/\bgh\s+([aeiou])/gi,    'gh$1'],
];

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — BM Educational Lexicon
// Maps broken ASR fragments → correct BM educational terms.
// Keys are lowercase for case-insensitive matching.
// ─────────────────────────────────────────────────────────────────────────────

const BM_LEXICON = {
  // Karangan (essay) terms
  'karangan per bah asan':     'karangan perbahasan',
  'karangan per ba ha san':    'karangan perbahasan',
  'ka rang an':                'karangan',
  'ka ra ngan':                'karangan',
  'per bah asan':              'perbahasan',
  'per ba ha san':             'perbahasan',
  'pen da hu lu an':           'pendahuluan',
  'pen da hu lu':              'pendahuluan',
  'pe nut up':                 'penutup',
  'pe nu tup':                 'penutup',
  'pe reng gan':               'perenggan',
  'per eng gan':               'perenggan',
  'pe ren gg an':              'perenggan',
  'hu ra i an':                'huraian',
  'hu rai an':                 'huraian',
  'a ya t':                    'ayat',
  'ru mu san':                 'rumusan',
  'ru mu s an':                'rumusan',
  'ke si mu lan':              'kesimpulan',
  'ke sim pu lan':             'kesimpulan',
  'isi kan dungan':            'isi kandungan',
  'i si kan dung an':          'isi kandungan',
  'i si':                      'isi',
  'pi a wai':                  'piawai',
  'pi aw ai':                  'piawai',
  'tek ni kal':                'teknikal',
  'tek nik al':                'teknikal',

  // Grammar / language terms (Tatabahasa)
  'ta ta ba ha sa':            'tatabahasa',
  'ta tab a ha sa':            'tatabahasa',
  'ke ba ha sa an':            'kebahasaan',
  'ke ba ha sa':               'kebahasaan',
  'mor fol o gi':              'morfologi',
  'mor fo lo gi':              'morfologi',
  'sin tak sis':               'sintaksis',
  'sin tak s is':              'sintaksis',
  'fo no lo gi':               'fonologi',
  'fo n o lo gi':              'fonologi',
  'se man tik':                'semantik',
  'se man ti k':               'semantik',
  'prag ma tik':               'pragmatik',
  'prag ma ti k':              'pragmatik',
  'di a lek':                  'dialek',
  'di a le k':                 'dialek',
  'i di om':                   'idiom',
  'i di o m':                  'idiom',
  'pe ri ba ha sa':            'peribahasa',
  'per iba ha sa':             'peribahasa',
  'pe ri ba h a sa':           'peribahasa',
  'per i ba ha sa':            'peribahasa',
  'sim bo lik':                'simbolik',
  'sim bo li k':               'simbolik',
  'per la mbang an':           'perlambangan',
  'pe nya ta':                 'penyata',
  'pe nyata':                  'penyata',
  'ayat per nya ta an':        'ayat penyataan',
  'a yat so al an':            'ayat soalan',
  'a yat ser u an':            'ayat seruan',
  'a yat pe rin tah':          'ayat perintah',
  'kata ker ja':               'kata kerja',
  'kata na ma':                'kata nama',
  'kata si fat':               'kata sifat',
  'kata ke te rang an':        'kata keterangan',
  'kata ga nti na ma':         'kata ganti nama',
  'kata hu bung':              'kata hubung',
  'kata de pan':               'kata depan',
  'kata sen di':               'kata sendi',
  'kata se ru an':             'kata seruan',
  'kata tanya':                'kata tanya',
  'kata peng hubung':          'kata penghubung',

  // Comprehension / reading terms (Pemahaman)
  'pe ma ha man':              'pemahaman',
  'pem ba ca an':              'pembacaan',
  'pem bahagian':              'pembahagian',
  'pem ba ha gi an':          'pembahagian',
  'id ea ter su rat':          'idea tersurat',
  'i de a ter su rat':         'idea tersurat',
  'idea ter si rat':           'idea tersirat',
  'i de a ter si rat':         'idea tersirat',

  // Summary / rumusan terms
  'ru mu san ter su rat':      'rumusan tersurat',
  'ru mu san ter si rat':      'rumusan tersirat',
  'per nyata an u ta ma':      'pernyataan utama',
  'pe ny a ta an':             'pernyataan',

  // Literature forms (Kesusasteraan)
  'si nop sis':                'sinopsis',
  'si nop s is':               'sinopsis',
  'si no p sis':               'sinopsis',
  'an to lo gi':               'antologi',
  'an to l o gi':              'antologi',
  'pro sa':                    'prosa',
  'pro s a':                   'prosa',
  'pu isi':                    'puisi',
  'pu i si':                   'puisi',
  'cer pen':                   'cerpen',
  'cer pe n':                  'cerpen',
  'no vel':                    'novel',
  'no ve l':                   'novel',
  'dra ma':                    'drama',
  'dra m a':                   'drama',
  'ma jaz':                    'majaz',
  'ma ja z':                   'majaz',
  'per sa ja kan':             'persajakan',
  'per sa ja':                 'persajakan',
  'ri ma':                     'rima',
  'ri m a':                    'rima',
  'rit ma':                    'ritma',
  'rit m a':                   'ritma',
  'i ma ji':                   'imaji',
  'i ma j i':                  'imaji',
  'sim i li':                  'simili',
  'sim i l i':                 'simili',
  'me ta fo ra':               'metafora',
  'me ta fo r a':              'metafora',
  'per so ni fi ka si':        'personifikasi',
  'per so ni fi ka':           'personifikasi',
  'hi per bo la':              'hiperbola',
  'hi per bo l a':             'hiperbola',
  'ana fo ra':                 'anafora',
  'a na fo ra':                'anafora',
  'e pi fo ra':                'epifora',
  'e pi fo r a':               'epifora',
  'alus i':                    'alusi',
  'a lu si':                   'alusi',
  'ok si mo ron':              'oksimoron',
  'ok si mo r on':             'oksimoron',

  // Pantun structure
  'pan tun':                   'pantun',
  'pan tu n':                  'pantun',
  'pe m ba yang an':           'pembayang an',
  'pem ba yang an':            'pembayang an',
  'mak su ud':                 'maksud',
  'mak su d':                  'maksud',
  'mak na':                    'makna',
  'mak n a':                   'makna',
  'sha ir':                    'syair',
  'sha i r':                   'syair',
  'sya i r':                   'syair',
  'gu ri ndam':                'gurindam',
  'gu rin dam':                'gurindam',
  'man tra':                   'mantra',
  'man tr a':                  'mantra',
  'se lo ka':                  'seloka',
  'se lo k a':                 'seloka',
  'te rom ba':                 'teromba',

  // Themes and characters
  'wa tak':                    'watak',
  'wa ta k':                   'watak',
  'pe wa tak an':              'perwatakan',
  'pe r wa tak an':            'perwatakan',
  'la tar be la kang':         'latar belakang',
  'la tar be la kan g':        'latar belakang',
  'te ma':                     'tema',
  'te m a':                    'tema',
  'per so a lan':              'persoalan',
  'per so a l an':             'persoalan',
  'ni lai':                    'nilai',
  'ni la i':                   'nilai',
  'peng a jar an':             'pengajaran',
  'peng a ja ran':             'pengajaran',
  'ga ya ba ha sa':            'gaya bahasa',
  'ga ya ba ha s a':           'gaya bahasa',

  // SPM paper sections
  'pem a ham an':              'pemahaman',
  'ke fa ha man':              'kefahaman',
  'ke fa ha m an':             'kefahaman',
  'ko mu ni ka si':            'komunikasi',
  'ko mu ni ka s i':           'komunikasi',
  'pe nu lis an':              'penulisan',
  'pe nu li san':              'penulisan',

  // Common study words
  'con toh':                   'contoh',
  'con to h':                  'contoh',
  'mi sal nya':                'misalnya',
  'mi sal n ya':               'misalnya',
  'je las kan':                'jelaskan',
  'je las k an':               'jelaskan',
  'ny a ta kan':               'nyatakan',
  'ke na pa':                  'kenapa',
  'ke na p a':                 'kenapa',
  'ba gai ma na':              'bagaimana',
  'ba gai ma n a':             'bagaimana',
  'me ng a pa':                'mengapa',
  'se ba rang':                'sebarang',
  'se ba r ang':               'sebarang',
};

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 3 — KOMSAS + SPM BM Specific Terms
// Novel titles, author names, literature frameworks, SPM-specific acronyms
// ─────────────────────────────────────────────────────────────────────────────

const KOMSAS_LEXICON = {
  // KOMSAS itself
  'ko mas':                    'KOMSAS',
  'ko m as':                   'KOMSAS',
  'kom sas':                   'KOMSAS',
  'kom s as':                  'KOMSAS',
  'k o m s a s':               'KOMSAS',

  // Literature analysis frameworks
  'im bak up':                 'IMBAKUP',
  'im bak u p':                'IMBAKUP',
  'i m b a k u p':             'IMBAKUP',
  'tegsp':                     'TEGSP',
  'spit':                      'SPIT',
  'peta i think':              'Peta i-THINK',
  'peta i - think':            'Peta i-THINK',
  'pe ta i think':             'Peta i-THINK',

  // Popular KOMSAS novels (Form 4 & 5)
  'pa min':                    'Pamin',
  'pa min novel':              'novel Pamin',
  'bu rung-bu rung':           'Burung-burung',
  'bu rung bu rung':           'Burung-burung',
  'sha li ha':                 'Shaliha',
  'sya li ha':                 'Shaliha',
  'a gong a la m':             'Agong Alam',
  'do dol':                    'Dodol',
  'do do l':                   'Dodol',
  'di per sa da nan':          'di persadanan',
  'cinta si':                  'Cinta Si',
  'cinta si tem pu rung':      'Cinta Si Tempurung',
  'si tem pu rung':            'Si Tempurung',

  // Poems and short stories commonly studied
  'bi duk ber lan da s':       'Biduk Berladas',
  'la yang la yang':           'Layang-layang',
  'la yang-la yang':           'Layang-layang',
  'me ra yu':                  'Merayu',
  'me ra y u':                 'Merayu',
  'tok wan':                   'Tok Wan',
  'tok na n':                  'Tok Nan',
  'pak u bang':                'pakubang',

  // Author names (common in KOMSAS)
  'sha non ah mad':            'Shahnon Ahmad',
  'sha hnon':                  'Shahnon',
  'a re pin':                  'Arepin',
  'u smah':                    'Usman',
  'uz man':                    'Usman',
  'a. sa mah':                 'A. Samad Said',
  'a sam ad':                  'A. Samad',
  'sa mad said':               'Samad Said',
  'lat if mo ha mad':          'Latiff Mohidin',
  'la tif mo hi din':          'Latiff Mohidin',

  // SPM BM exam terms
  's p m':                     'SPM',
  'u ps r':                    'UPSR',
  'p t 3':                     'PT3',
  'se kolah me ne ngah a tas': 'Sekolah Menengah Atas',
  'b m':                       'BM',
  'ba ha sa me la yu':         'Bahasa Melayu',
  'ba ha sa ma lay sia':       'Bahasa Malaysia',

  // Other SPM BM specific
  'pe pe rik saan':            'peperiksaan',
  'pe pe ri k saan':           'peperiksaan',
  'ang ka gi li ran':          'angka giliran',
  'an gka gi li ran':          'angka giliran',
  'ker tas so alan':           'kertas soalan',
  'ker tas so al an':          'kertas soalan',
  'ba ha gi an a':             'Bahagian A',
  'ba ha gi an b':             'Bahagian B',
  'ba ha gi an c':             'Bahagian C',
  'ba ha gi an d':             'Bahagian D',
  'mar kah pe nu h':           'markah penuh',
  'mar kah pe nuh':            'markah penuh',
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply Layer 1: phonetic regex fixes.
 */
function applyPhoneticFixes(text) {
  let out = text;
  for (const [pattern, replacement] of PHONETIC_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Apply a lexicon dictionary to text (case-insensitive, longest-match-first).
 * Returns the corrected text.
 */
function applyLexicon(text, lexicon) {
  // Sort by key length descending to ensure longest match wins
  const entries = Object.entries(lexicon).sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [bad, good] of entries) {
    // Escape bad string for use in regex
    const escaped = bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    // Preserve casing: if original is all-caps, use GOOD in caps; else use good as-is
    out = out.replace(re, (match) => {
      if (match === match.toUpperCase() && match.length > 2) return good.toUpperCase();
      return good;
    });
  }
  return out;
}

/**
 * Normalize whitespace: collapse multiple spaces, trim lines.
 */
function normalizeWhitespace(text) {
  return text
    .split('\n')
    .map(line => line.replace(/\s{2,}/g, ' ').trim())
    .filter(line => line.length > 0)
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 4 — Claude Semantic Cleanup
// ─────────────────────────────────────────────────────────────────────────────

const CLAUDE_CLEANUP_PROMPT = `You are a Bahasa Malaysia language expert specialising in SPM education.

You will receive a YouTube auto-caption transcript that has been partially cleaned up. The transcript is from a BM lesson or KOMSAS literature class.

Your job is to fix ANY remaining errors:
1. Rejoin any BM words still split across spaces by ASR phonetic errors
2. Correct any BM educational or KOMSAS terms still wrong
3. Fix grammar term spellings (tatabahasa, morfologi, sintaksis, etc.)
4. Correct author names, novel titles, KOMSAS framework names
5. Do NOT change sentence meaning — preserve the teacher's exact content
6. Do NOT translate — output must remain in Bahasa Malaysia
7. Do NOT add or remove content — only fix existing errors

Return ONLY the corrected transcript, no explanation, no preamble.`;

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT — run full 4-layer pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Correct a raw YouTube BM ASR transcript using the 4-layer pipeline.
 *
 * @param {string} rawTranscript - Raw YouTube auto-caption text
 * @param {object} anthropic - Anthropic client instance
 * @param {object} options
 * @param {boolean} options.skipClaude - Skip Layer 4 (for fast/batch processing)
 * @param {boolean} options.verbose - Return layer-by-layer output for debugging
 * @returns {Promise<{ corrected: string, layers?: object }>}
 */
export async function correctBMTranscript(rawTranscript, anthropic, { skipClaude = false, verbose = false } = {}) {
  if (!rawTranscript || typeof rawTranscript !== 'string') {
    return { corrected: rawTranscript || '' };
  }

  // Layer 1: Phonetic fixes
  const layer1 = applyPhoneticFixes(rawTranscript);

  // Layer 2: BM educational lexicon
  const layer2 = applyLexicon(layer1, BM_LEXICON);

  // Layer 3: KOMSAS + SPM BM specific
  const layer3 = applyLexicon(layer2, KOMSAS_LEXICON);

  // Normalize whitespace after dictionary passes
  const layer3clean = normalizeWhitespace(layer3);

  // Layer 4: Claude semantic cleanup
  let layer4 = layer3clean;
  if (!skipClaude && anthropic) {
    try {
      const r = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: CLAUDE_CLEANUP_PROMPT,
        messages: [{ role: 'user', content: layer3clean }],
      });
      layer4 = r.content[0].text.trim();
    } catch (err) {
      console.error('[BMCorrection] Claude layer failed:', err.message);
      layer4 = layer3clean; // fall back to layer 3 result
    }
  }

  if (verbose) {
    return {
      corrected: layer4,
      layers: { raw: rawTranscript, layer1, layer2, layer3: layer3clean, layer4 },
    };
  }
  return { corrected: layer4 };
}

/**
 * Quick correction (Layers 1–3 only, no Claude call).
 * Use for real-time previews or batch processing.
 */
export function quickCorrectBM(rawTranscript) {
  if (!rawTranscript || typeof rawTranscript !== 'string') return rawTranscript || '';
  const l1 = applyPhoneticFixes(rawTranscript);
  const l2 = applyLexicon(l1, BM_LEXICON);
  const l3 = applyLexicon(l2, KOMSAS_LEXICON);
  return normalizeWhitespace(l3);
}

/**
 * Expose lexicons for testing or extension.
 */
export { BM_LEXICON, KOMSAS_LEXICON, PHONETIC_PATTERNS };
