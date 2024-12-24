const mongoose = require('mongoose');

// Define the Option schema for each question
const optionSchema = new mongoose.Schema({
  text: { type: String },  // Text for the option
  image: { type: String },  // URL for an image, can be optional
});

const CodingQuestionSchema = new mongoose.Schema({
  programSlug: { type: String, required: true, unique: true },
  problemName: { type: String, required: true },
  description: { type: String, required: true },
  problemStatement: { type: String, required: true },
  inputFormat: { type: String, required: true },
  outputFormat: { type: String, required: true },
  constraints: { type: String, required: true },
  sampleInput: { type: String, required: true },
  sampleOutput: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
// Define the Question schema
const questionSchema = new mongoose.Schema({
  section: { type: String, required: true }, // New field for 
  question: { type: String },  // The question text
  questionImage: { type: String },  // URL for the question image (optional)
  options: [optionSchema],  // Array of options (optionSchema)
  correctOption: { type: String },  // Correct option's text
  explanation: { type: String },  // Explanation for the answer (optional)
  timeLimit: { type: Number },  // Time limit for this question in seconds
});

// Define the User Response schema
const userResponseSchema = new mongoose.Schema({
  questionIndex: { type: Number },  // Index of the question in the quiz
  answer: { type: String },  // User's answer to the question
  markedForReview: { type: Boolean, default: false },  // Whether the question is marked for review
  correct: { type: Boolean },  // Whether the user's answer was correct
  timeSpent: { type: Number, default: 0 },  // Time spent on this question in seconds
});

// Define the User Profile schema (optional for quiz management)
const userProfileSchema = new mongoose.Schema({
  username: { type: String },  // The username of the user
  name: { type: String },  // User's full name
  email: { type: String },  // User's email
  phone: { type: String },  // Phone number
  rollNumber: { type: String },  // Roll number or student ID
  department: { type: String },  // Department of the user
  graduationYear: { type: String },  // Graduation year
  cgpa: { type: String },  // CGPA
  address: { type: String },  // Address of the user
  skills: { type: String },  // Skills of the user
  linkedin: { type: String },  // Optional LinkedIn URL
  github: { type: String },  // Optional GitHub URL
  projects: { type: String },  // Projects description
  internshipExperience: { type: String },  // Internship experience description
  extracurriculars: { type: String },  // Extracurricular activities description
});

// Define the User Quiz Result schema (tracks individual user attempts)
const userQuizResultSchema = new mongoose.Schema({
  username: { type: String, required: true },
  responses: { type: Array, required: true }, // Array of user's answers
  completed: { type: Boolean, default: false },
  submittedAt: { type: Date },
  totalTimeSpent: { type: Number },
  correctAnswers: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  isPass: { type: Boolean, default: false },
  malpracticeCount: { type: Number, default: 0 }, // Track malpractice count
  isAutoSubmit: { type: Boolean, default: false }, // Indicate auto-submission
});

// Define the Quiz schema
const quizSchema = new mongoose.Schema({
  quizTitle: { type: String },  // Title of the quiz
  quizDescription: { type: String },  // Description of the quiz
  quizType: { type: String, enum: ['hiring', 'practice'] },  // Type of quiz (hiring or practice)
  passPercentage: { type: Number, required: true }, // Add this field
  numberOfQuestions: { type: Number, required: true },
  questionsToSet: {
    type: Number,
    required: true,
    validate: {
      validator: function (value) {
        return value > 0;
      },
      message: 'questionsToSet must be a positive number',
    },
  },
  quizDate: { type: String, required: function () { return this.quizType === "hiring"; } }, // Format: YYYY-MM-DD
  quizTime: { type: String, required: function () { return this.quizType === "hiring"; } }, // Format: HH:MM
  quizDuration: { type: Number, required: function () { return this.quizType === "hiring"; } }, // Duration in minutes

  questionTimer: { type: Number, required: function () { return this.quizType === "practice"; } },
  malpracticeLimit: { type: Number }, // Default limit is 3
  sections: { type: [String], required: true }, // New field for sections
  credentials: [{  // Array of generated credentials for quiz access
    username: { type: String },
    password: { type: String },
  }],
  questions: [questionSchema],  // Array of questions for the quiz
  userProfiles: [userProfileSchema],  // Array of user profiles tied to this quiz
  userResponses: [userQuizResultSchema],  // Array of user quiz results (per user)
});

// Create the model based on the Quiz schema
const Quiz = mongoose.model('Quiz', quizSchema);

module.exports = Quiz;
