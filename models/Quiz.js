const mongoose = require('mongoose');

// Define the Option schema for each question
const optionSchema = new mongoose.Schema({
  text: { type: String },  // Text for the option
  image: { type: String },  // URL for an image, can be optional
});

const codingQuestionSchema = new mongoose.Schema({
  image: { type: String, required: false }, // Optional image URL
  programSlug: { type: String, required: true }, // Unique identifier for the coding problem
  problemName: { type: String, required: true }, // Name of the problem
  description: { type: String, required: true }, // Brief description of the problem
  problemStatement: { type: String, required: true }, // Full problem statement
  inputFormat: { type: String, required: true }, // Input format for the problem
  outputFormat: { type: String, required: true }, // Output format for the problem
  constraints: { type: String, required: true }, // Constraints for the problem
  sampleInput: { type: String, required: true }, // Sample input for the problem
  sampleOutput: { type: String, required: true }, // Sample output for the problem
  privateTestCases: { type: [String], required: true, default: [] }, // Array of private test cases

  section: {
    type: String,
    default: "default", // Default section
    required: function () {
        return this.sectionFeatureActive; // Conditionally required based on sectionFeatureActive
    },
},
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
  answer: { type: String },
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
  isLoggedIn: { type: Boolean, default: false },
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
  codingWithQuiz: { type: Boolean, default: false },
  onlyCoding: { type: Boolean, default: false },
  codingTimer: {
    type: Number,
    required: false, // Optional for quizzes without coding
},

  passPercentage: { type: Number, required: true }, // Add this field
  numberOfQuestions: { type: Number, },
  questionsToSet: {
    type: Number,
    required: function () {
      return !this.onlyCoding; // Required only if not onlyCoding
  },
    
  },
  quizDate: { type: String, required: function () { return this.quizType === "hiring"; } }, // Format: YYYY-MM-DD
  quizTime: { type: String, required: function () { return this.quizType === "hiring"; } }, // Format: HH:MM
  quizDuration: {
    type: Number,
    required: function () {
        return this.quizType === "hiring" && !this.onlyCoding; // Required only for "Hiring" quizzes that are not "Only Coding"
    },
    validate: {
        validator: function (value) {
            return this.quizType !== "hiring" || this.onlyCoding || (value > 0); // Must be a positive number for "Hiring" quizzes
        },
        message: "quizDuration must be a positive number.",
    },
},

  questionTimer: { type: Number,  required: function () {
    return this.quizType === "practice" && !this.onlyCoding; // Required for practice quizzes, but not for onlyCoding
}, },
  malpracticeLimit: { type: Number }, // Default limit is 3
  sections: { type: [String], }, // New field for sections
  credentials: [{  // Array of generated credentials for quiz access
    username: { type: String },
    password: { type: String },
    isUsed: { type: Boolean, default: false },
  }],
  questions: [questionSchema],  // Array of questions for the quiz
  codingQuestions: [codingQuestionSchema], // Array of coding questions
  userProfiles: [userProfileSchema],  // Array of user profiles tied to this quiz
  userResponses: [userQuizResultSchema],  // Array of user quiz results (per user)
});

// Create the model based on the Quiz schema
const Quiz = mongoose.model('Quiz', quizSchema);

module.exports = Quiz;
