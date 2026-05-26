/**
 * LEARNOVA INDONESIAN PEDAGOGY ENGINE
 * 4-Layer system — mirrors BM engine but for ID context
 *
 * Layer 1: SNBT/UTBK exam intelligence
 * Layer 2: Indonesian cultural pedagogy patterns
 * Layer 3: Subject-specific cognitive strategies
 * Layer 4: Adaptive emotional coaching
 */

export const ID_PEDAGOGY_LAYERS = {

  // ── LAYER 1: EXAM INTELLIGENCE ─────────────────────────
  exam_intelligence: {
    snbt: {
      tps: {
        verbal_reasoning: 'Penalaran verbal — hubungan kata, analogi, pola bahasa',
        quantitative: 'Penalaran kuantitatif — operasi cepat, estimasi, pola angka',
        figure: 'Penalaran figural — rotasi, pola visual, transformasi',
      },
      literacy_bahasa: {
        reading_comprehension: 'Pemahaman bacaan — teks fiksi dan nonfiksi',
        argument_analysis: 'Analisis argumen — memperkuat/memperlemah',
        inference: 'Inferensi dan simpulan berdasarkan teks',
      },
      literacy_english: {
        discourse_navigation: 'Navigasi wacana — sinyal teks, struktur paragraf',
        vocabulary_inference: 'Inferensi kosakata dari konteks',
        grammar_reasoning: 'Penalaran tata bahasa',
      },
      mathematics: {
        algebra: 'Aljabar — persamaan, pertidaksamaan, SPLDV',
        functions: 'Fungsi — domain, range, komposisi, invers',
        trigonometry: 'Trigonometri — nilai khusus, identitas',
        statistics: 'Statistika — peluang, distribusi',
      },
    },
    skd: {
      twk: 'Tes Wawasan Kebangsaan — Pancasila, UUD, sejarah',
      tiu: 'Tes Intelejensi Umum — penalaran, verbal, numerik',
      tkp: 'Tes Karakteristik Pribadi — perilaku kerja, situasional',
    },
  },

  // ── LAYER 2: INDONESIAN CULTURAL PEDAGOGY ─────────────
  cultural_pedagogy: {
    encouragement_patterns: [
      'Kamu pasti bisa!',
      'Sedikit lagi, semangat!',
      'Udah bagus banget, tinggal satu langkah lagi',
      'Ini sebenarnya gampang kalau sudah paham polanya',
      'Coba lagi, kamu pasti bisa lebih cepat',
    ],
    speed_culture: {
      note: 'Indonesian SNBT culture values speed and shortcuts highly',
      approach: 'Introduce shortcuts AFTER concept is understood',
      language: [
        'Cara cepat:',
        'Triknya:',
        'Langsung bisa:',
        '5 detik:',
        'Tanpa hitung panjang:',
      ],
    },
    identity_building: [
      'Pejuang SNBT',
      'Calon mahasiswa',
      'Kamu yang pantang menyerah',
    ],
    normalization: [
      'Wajar kalau bingung pertama kali',
      'Semua orang butuh waktu untuk paham ini',
      'Lupa itu bagian dari belajar',
    ],
  },

  // ── LAYER 3: SUBJECT COGNITIVE STRATEGIES ─────────────
  subject_strategies: {

    mathematics: {
      pedagogy_modes: {
        concept_mode: {
          description: 'Bangun intuisi dulu, rumus belakangan',
          triggers: ['pertama kali topik', 'siswa bingung', 'konsep abstrak'],
          approach: 'Mulai dari situasi nyata -> variabel -> persamaan -> abstrak',
          learnova_method: 'MaknaFirst',
        },
        speed_mode: {
          description: 'Optimalkan untuk ujian bertahap',
          triggers: ['siswa sudah paham konsep', 'latihan ujian', 'target waktu'],
          approach: 'Kenali pola -> eliminasi cepat -> verifikasi minimal',
          learnova_method: 'PattaRapid',
        },
        memory_mode: {
          description: 'Kompresi memori untuk recall cepat',
          triggers: ['nilai khusus', 'rumus padat', 'hafalan diperlukan'],
          approach: 'Buat sistem generasi, bukan hafalan individual',
          learnova_method: 'GenSystem',
        },
        framework_mode: {
          description: 'Kerangka berpikir konsisten untuk soal kompleks',
          triggers: ['soal cerita', 'masalah multi-langkah', 'SPLDV'],
          approach: 'Baca -> Terjemahkan -> Selesaikan -> Verifikasi',
          learnova_method: 'SolveSmart',
        },
      },
      fear_reduction: {
        symbol_anxiety: 'Huruf dalam matematika hanyalah nama — seperti nama orang',
        abstraction_shock: 'Rumus adalah jalan pintas untuk situasi yang sering terjadi',
        word_problem_block: 'Ubah bahasa soal jadi bahasa matematika dulu',
      },
    },

    literacy_bahasa: {
      pedagogy_modes: {
        evidence_mode: {
          description: 'Semua jawaban harus bersumber dari teks',
          rule: 'Tidak ada jawaban dari pengetahuan luar atau asumsi pribadi',
          learnova_method: 'TextAnchor',
        },
        navigation_mode: {
          description: 'Baca strategis, bukan baca semua',
          tools: ['scanning', 'skimming', 'keyword targeting'],
          learnova_method: 'SmartScan',
        },
        argument_mode: {
          description: 'Evaluasi hubungan logis antar pernyataan',
          questions: ['Apakah ini mendukung?', 'Apakah ini melemahkan?', 'Apakah relevan?'],
          learnova_method: 'ClaimLink',
        },
        narrative_mode: {
          description: 'Inferensi karakter dari perilaku, bukan deskripsi langsung',
          approach: 'Apa yang dilakukan tokoh -> apa artinya -> watak apa yang ditunjukkan',
          learnova_method: 'BehaviorRead',
        },
      },
      question_taxonomy: {
        tema: 'Cari gagasan utama di seluruh teks',
        penokohan: 'Cari tindakan dan dialog tokoh',
        alur: 'Urutan peristiwa dan konflik',
        latar: 'Tempat, waktu, suasana',
        amanat: 'Pesan moral dari keseluruhan cerita',
        sudut_pandang: 'Siapa yang bercerita dan dari perspektif mana',
      },
    },

    english: {
      pedagogy_modes: {
        discourse_mode: {
          description: 'Detect text signals before reading deeply',
          signals: {
            'found/showed': 'research result follows',
            'however/but': 'contrast and key argument follows',
            'there are many ways': 'ordered list follows',
            'several factors': 'sequential explanation follows',
          },
          learnova_method: 'SignalFirst',
        },
        vocabulary_mode: {
          description: 'Infer meaning from context, not dictionary',
          strategies: ['emotional clues', 'semantic category', 'sentence function'],
          learnova_method: 'ContextGuess',
        },
        grammar_mode: {
          description: 'Grammar as time logic, not formula memorization',
          core_model: 'Every tense = a relationship between events and time',
          learnova_method: 'TimeMap',
        },
        retention_mode: {
          description: 'Vocabulary through meaningful repetition not lists',
          principles: ['relevance', 'spaced repetition', 'active usage'],
          learnova_method: 'NaturalLock',
        },
      },
    },

    physics: {
      pedagogy_modes: {
        concept_mode: {
          description: 'Physics intuition before equations',
          approach: 'What is happening physically -> why does math describe it',
          learnova_method: 'PhysFirst',
        },
        graph_mode: {
          description: 'Extract meaning from visual representations',
          skills: ['threshold detection', 'slope interpretation', 'region analysis'],
          learnova_method: 'GraphRead',
        },
        spatial_mode: {
          description: 'Vectors as movement and direction',
          approach: 'Physical movement -> geometric arrows -> algebraic notation',
          learnova_method: 'MoveMap',
        },
      },
    },
  },

  // ── LAYER 4: ADAPTIVE EMOTIONAL COACHING ──────────────
  emotional_coaching: {

    detect_states: {
      overwhelmed: {
        signals: ['soal terlalu panjang', 'terlalu banyak rumus', 'bingung mulai dari mana'],
        response: 'Mulai dari yang paling kecil dulu — satu langkah aja',
      },
      fear_of_abstraction: {
        signals: ['kenapa pakai huruf', 'gak ngerti simbol', 'rumus susah'],
        response: 'Huruf itu cuma nama untuk sesuatu yang belum kita tahu — sama kayak kita belum tau nama orang baru',
      },
      speed_anxiety: {
        signals: ['waktunya kurang', 'ga keburu', 'lambat banget'],
        response: 'Akurasi dulu, kecepatan menyusul — yang penting benar dulu',
      },
      repeated_failure: {
        signals: ['salah terus', 'udah coba berkali-kali', 'gak bisa juga'],
        response: 'Kalau salah artinya otak kamu lagi ngasih tahu mana yang perlu diperkuat — itu bagus',
      },
      confidence_peak: {
        signals: ['bisa!', 'paham', 'gampang ternyata'],
        response: 'Nah, sekarang kamu siap ke level berikutnya',
      },
    },

    pacing_rules: {
      beginner: 'Pelan, satu konsep per sesi, banyak konfirmasi',
      intermediate: 'Normal, bisa skip yang sudah paham, fokus kelemahan',
      exam_prep: 'Cepat, target waktu, simulasi kondisi ujian',
    },
  },
};

// ── PEDAGOGY TYPE CLASSIFIER ─────────────────────────────

export function classifyPedagogyNeeded(subject, topic, studentState) {
  const subjectConfig = ID_PEDAGOGY_LAYERS.subject_strategies[subject];
  if (!subjectConfig) return 'concept_mode';

  if (studentState?.isNewTopic || studentState?.confused) return 'concept_mode';
  if (studentState?.examMode || studentState?.requestedSpeed) return 'speed_mode';

  const memoryTopics = ['trigonometri', 'nilai khusus', 'rumus', 'hafalan'];
  if (topic && memoryTopics.some(t => topic.toLowerCase().includes(t))) return 'memory_mode';

  const frameworkTopics = ['soal cerita', 'spldv', 'persamaan', 'word problem'];
  if (topic && frameworkTopics.some(t => topic.toLowerCase().includes(t))) return 'framework_mode';

  return 'concept_mode';
}

export default ID_PEDAGOGY_LAYERS;
