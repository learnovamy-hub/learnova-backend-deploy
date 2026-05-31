import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import routes
import authRoutes from './routes/auth.js';
import lessonRoutes from './routes/lessons.js';
import quizRoutes from './routes/quizzes.js';
import teacherRoutes from './routes/teachers.js';
import aiRoutes from './routes/ai.js';
import studentRoutes from './routes/students.js';
import auditRoutes from './routes/audit.js';
import tutorRoutes from './routes/tutor.js';
import sessionRoutes from './routes/sessions.js';
import parentRoutes from './routes/parent.js';
import adminRoutes from './routes/admin.js';
import workspaceRoutes from './routes/workspace.js';
import welcomeRoutes from './routes/welcome.js';
import sessionQuizRoutes from './routes/session_quiz.js';
import quizSessionRoutes from './routes/quiz.js';
import animationRoutes from './routes/animations.js';
import topicAnimationRoutes from './routes/topicAnimations.js';
import ttsRoutes from './routes/tts.js';
import homeRoutes from './routes/home.js';
import paymentRoutes from './routes/payment.js';
import transcriptRoutes from './routes/transcript.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// MIDDLEWARE
// ============================================================================

// CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));
app.options('*', cors());

// Stripe webhook needs raw body — register BEFORE json middleware
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================================
// ROUTES
// ============================================================================

// Auth routes
app.use('/api/auth', authRoutes);

// Lesson routes
app.use('/api/lessons', lessonRoutes);

// Quiz routes
app.use('/api/quizzes', quizRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/tutor', tutorRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/tutor/welcome', welcomeRoutes);
app.use('/api/session-quiz', sessionQuizRoutes);
app.use('/api/quiz', quizSessionRoutes);
app.use('/api/animations', animationRoutes);
app.use('/api/topic-animations', topicAnimationRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/transcript', transcriptRoutes);

// ============================================================================
// 404 HANDLER
// ============================================================================

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ============================================================================
// ERROR HANDLER
// ============================================================================

app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(error.status || 500).json({
    error: error.message || 'Internal server error'
  });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`âœ… Learnova Backend running on port ${PORT}`);
  console.log(`ðŸ"¡ Health check: http://localhost:${PORT}/health`);
  console.log(`ðŸ" API: http://localhost:${PORT}/api`);
});

export default app;













