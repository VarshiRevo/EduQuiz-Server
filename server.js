const express = require('express');
const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const Quiz = require('./models/Quiz'); // Assuming Quiz model is correctly defined
const env = require('dotenv')
const app = express();
const moment = require("moment-timezone");

const storage = multer.memoryStorage();
const upload = multer({ storage });
env.config();
// Middleware
app.use(cors({
    origin: ['https://elevatequiz.netlify.app', 'http://localhost:5173','https://elevatequiz-coding.netlify.app'], // Allow your frontend URL
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // Add the methods you need
    credentials: true, // Allow credentials if required
}));
app.use(express.json());


cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log('Connected to MongoDB'))
    .catch((error) => console.error('Error connecting to MongoDB:', error));


// Routes

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const quiz = await Quiz.findOne({
            'credentials.username': username,
            'credentials.password': password,
        });

        if (!quiz) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const userCredential = quiz.credentials.find(
            (cred) => cred.username === username && cred.password === password
        );

        if (!userCredential) {
            return res.status(404).json({ error: 'User not found in quiz credentials' });
        }

        // Check if the user has already logged in
        if (userCredential.isUsed) {
            return res.status(403).json({ error: 'Username expired. You cannot log in again.' });
        }

        // Quiz timing validation
        if (quiz.quizType === 'hiring') {
            const quizDate = quiz.quizDate || '';
            const quizTimeInSeconds = parseInt(quiz.quizTime, 10);

            const hours = Math.floor(quizTimeInSeconds / 3600);
            const minutes = Math.floor((quizTimeInSeconds % 3600) / 60);
            const seconds = quizTimeInSeconds % 60;
            const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

            const quizStartTime = moment.tz(`${quizDate} ${formattedTime}`, 'YYYY-MM-DD HH:mm:ss', 'Asia/Kolkata');
            const quizEndTime = quizStartTime.clone().add(quiz.quizDuration, 'minutes');
            const loginAccessStartTime = quizStartTime.clone().subtract(10, 'minutes');
            const currentTime = moment().tz('Asia/Kolkata');

            if (currentTime.isBefore(loginAccessStartTime)) {
                return res.status(403).json({
                    error: 'The quiz is not yet accessible. Login allowed 10 minutes before the quiz start time.',
                });
            }
            if (currentTime.isAfter(quizEndTime)) {
                return res.status(403).json({
                    error: 'The quiz has already ended.',
                });
            }
        }

        // Mark the user credential as used
        userCredential.isUsed = true;

        // Mark the user as logged in
        const userResponse = quiz.userResponses.find((response) => response.username === username);
        if (!userResponse) {
            quiz.userResponses.push({
                username,
                isLoggedIn: true,
            });
        } else {
            userResponse.isLoggedIn = true;
        }

        await quiz.save();

        res.json({
            message: 'Login successful',
            quizId: quiz._id,
            username: userCredential.username,
            quizType: quiz.quizType,
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'An error occurred while logging in' });
    }
});








app.post('/api/quizzes/:quizId/users/:username/profile', async (req, res) => {
    const { quizId, username } = req.params;
    const userProfile = req.body;

    try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        // Find if the profile already exists for the given username
        const existingProfile = quiz.userProfiles.find((profile) => profile.username === username);
        if (existingProfile) {
            return res.status(400).json({ error: 'Profile already exists for this username' });
        }

        // Add the new user profile
        quiz.userProfiles.push({ username, ...userProfile });
        await quiz.save();

        res.json({ message: 'User profile saved successfully!', quiz });
    } catch (error) {
        console.error('Error saving user profile:', error);
        res.status(500).json({ error: 'Failed to save user profile' });
    }
});


app.get('/api/quizzes/:quizId/users/:username/profile', async (req, res) => {
    try {
        const { quizId, username } = req.params;
        const quiz = await Quiz.findById(quizId);
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

        const userProfile = quiz.userProfiles.find((profile) => profile.username === username);
        if (!userProfile) return res.status(404).json({ error: 'Profile not found' });

        res.json(userProfile); // Ensure this returns all fields
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


app.post('/api/quizzes/:quizId/users/:username/submit', async (req, res) => {
    const { quizId, username } = req.params;
    const { responses, totalTimeSpent } = req.body;

    console.log(`Submit request received for quizId: ${quizId}, username: ${username}`);
    console.log('Received Responses:', JSON.stringify(responses, null, 2));

    try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            console.warn(`Quiz with ID ${quizId} not found`);
            return res.status(404).json({ error: 'Quiz not found' });
        }

        console.log(`Quiz Questions:`, JSON.stringify(quiz.questions, null, 2));

        const userCredential = quiz.credentials.find((cred) => cred.username === username);
        if (!userCredential) {
            console.warn(`Username ${username} not found in quiz credentials`);
            return res.status(403).json({ error: 'User is not authorized for this quiz.' });
        }

        const existingResponse = quiz.userResponses.find((response) => response.username === username);
        if (existingResponse && existingResponse.completed) {
            return res.status(400).json({ error: 'Test already submitted' });
        }

        const questionsToSet = quiz.questionsToSet || quiz.questions.length; // Fallback to all questions if not set
        const shuffledQuestions = quiz.questions.slice(0, questionsToSet); // Use the first `questionsToSet` questions

        let correctAnswers = 0;

        // Validate user responses against correct options
        responses.forEach((response) => {
            const question = shuffledQuestions[response.questionIndex];
            if (!question) return;

            console.log(`Validating Question: ${response.questionIndex}`);
            console.log(`Correct Option: ${question.correctOption}`);
            console.log(`User's Answer: ${response.answer}`);

            const correctOptionIndex = question.correctOption; // Correct option is a string
            if (response.answer !== null && response.answer === correctOptionIndex) {
                console.log(`Answer is Correct`);
                correctAnswers += 1; // Increment score if correct
            } else {
                console.log(`Answer is Incorrect`);
            }
        });

        const percentage = (correctAnswers / questionsToSet) * 100; // Calculate based on `questionsToSet`
        const isPass = percentage >= quiz.passPercentage;

        console.log(`Correct Answers: ${correctAnswers}`);
        console.log(`Questions to Set: ${questionsToSet}`);
        console.log(`Percentage: ${percentage}`);

        // Remove any incomplete entry for the same user before saving
        quiz.userResponses = quiz.userResponses.filter((response) => response.username !== username);

        // Save the user's response and score
        quiz.userResponses.push({
            username,
            responses,
            completed: true,
            submittedAt: new Date(),
            totalTimeSpent,
            correctAnswers,
            percentage,
            isPass,
        });

        await quiz.save();

        console.log(`Test submitted successfully for username: ${username}`);
        res.status(200).json({
            message: 'Test submitted successfully!',
            correctAnswers,
            percentage,
            isPass,
        });
    } catch (error) {
        console.error('Error submitting test:', error);
        res.status(500).json({ error: 'Error submitting test' });
    }
});
















app.get('/api/quizzes/:quizId/results', async (req, res) => {
    try {
        const { quizId } = req.params;
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        // Combine user responses with user profile data
        const results = quiz.userResponses.map((response) => {
            const userProfile = quiz.userProfiles.find(profile => profile.username === response.username);
            return {
                username: response.username,
                name: userProfile?.name || 'N/A',
                email: userProfile?.email || 'N/A',
                completed: response.completed,
                isPass: response.isPass,
                correctAnswers: response.correctAnswers,
                percentage: response.percentage,
                totalTimeSpent: response.totalTimeSpent,
            };
        });

        res.json(results);
    } catch (error) {
        console.error('Error fetching results:', error);
        res.status(500).json({ error: 'Error fetching results' });
    }
});
const autoSubmitQuiz = async (quizId, username, quiz) => {
    try {
        const responses = quiz.questions.map((question, index) => ({
            questionIndex: index,
            answer: null, // Default unanswered questions to null
        }));

        // Calculate the score
        let correctAnswers = 0;
        responses.forEach((response) => {
            const question = quiz.questions[response.questionIndex];
            if (!question) return;

            const correctOptionIndex = parseInt(question.correctOption, 10);
            if (response.answer === correctOptionIndex) {
                correctAnswers += 1;
            }
        });

        const percentage = (correctAnswers / quiz.questions.length) * 100;
        const isPass = percentage >= quiz.passPercentage;

        // Save user response and score
        quiz.userResponses.push({
            username,
            responses,
            completed: true,
            submittedAt: new Date(),
            correctAnswers,
            percentage,
            isPass,
        });

        await quiz.save();
        console.log(`Quiz auto-submitted successfully for username: ${username}`);
    } catch (error) {
        console.error('Error during auto-submission:', error);
    }
};

app.get('/api/quizzes/:quizId', async (req, res) => {
    try {
        const { quizId } = req.params;
        const quiz = await Quiz.findById(quizId);

        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        const quizTimeInSeconds = parseInt(quiz.quizTime, 10) || 0;
        let quizStartTime, quizEndTime;

        // Validate quizTime format
        if (isNaN(quizTimeInSeconds)) {
            return res.status(400).json({ error: 'Invalid quizTime format. Must be in seconds.' });
        }

        if (quiz.quizType === 'hiring') {
            // Hiring quiz logic
            const hours = Math.floor(quizTimeInSeconds / 3600);
            const minutes = Math.floor((quizTimeInSeconds % 3600) / 60);
            const seconds = quizTimeInSeconds % 60;

            // Format quizTime into "HH:mm:ss"
            const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

            // Calculate start, end, and early access times
            quizStartTime = moment.tz(`${quiz.quizDate} ${formattedTime}`, "YYYY-MM-DD HH:mm:ss", "Asia/Kolkata");
            const loginAccessStartTime = quizStartTime.clone().subtract(10, 'minutes'); // 10 minutes early access
            quizEndTime = quizStartTime.clone().add(quiz.quizDuration, 'minutes');

            // Validate current time
            const currentTime = moment().tz("Asia/Kolkata");

            if (currentTime.isBefore(loginAccessStartTime)) {
                return res.status(403).json({
                    error: 'The quiz is not accessible yet. Access is allowed 10 minutes before the start time.'
                });
            }

            if (currentTime.isAfter(quizEndTime)) {
                console.warn(`Timer expired for quizId: ${quizId}, submitting automatically.`);
                return res.status(200).json({ message: 'Quiz automatically submitted as the timer expired.' });
            }
        } else if (quiz.quizType === 'practice') {
            // For practice quizzes, no time restrictions
            quizStartTime = null;
            quizEndTime = null;
        }

        // Calculate sections and questions by section
        const sections = [...new Set(quiz.questions.map((q) => q.section || 'default'))]; // Get unique sections
        const questionsBySection = sections.reduce((acc, section) => {
            acc[section] = quiz.questions.filter((q) => q.section === section);
            return acc;
        }, {});

        // Respond with quiz details
        res.json({
            quizTitle: quiz.quizTitle,
            quizDescription: quiz.quizDescription,
            quizType: quiz.quizType,
            questionsToSet: quiz.questionsToSet,
            timeLimit: quiz.quizDuration || "Not specified", // Default value
            quizStartTime: quizStartTime ? quizStartTime.toISOString() : null,
            quizEndTime: quizEndTime ? quizEndTime.toISOString() : null,
            bannerImageUrl: quiz.bannerImageUrl,
            questions: quiz.questions || [], // Default to empty array if questions are not provided
            sections, // Include the sections
            questionsBySection, // Include questions grouped by sections

        });

    } catch (error) {
        console.error('Error fetching quiz:', error);
        res.status(500).json({ error: 'Failed to fetch quiz.' });
    }
});








app.get('/api/quizzes/:quizId/users/:username', async (req, res) => {
    const { quizId, username } = req.params;

    try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

        const {
            questions,
            questionsToSet,
            quizTitle,
            quizDescription,
            questionTimer,
            passPercentage,
            quizType,
            quizDate,
            quizTime,
            quizDuration,
            malpracticeLimit
        } = quiz;

        console.log("Raw quizDate:", quizDate);
        console.log("Raw quizTime:", quizTime);

        let quizStartTime = null;
        let quizEndTime = null;
        let formattedTime = "";
        const quizDurationInSeconds = quizDuration ? quizDuration * 60 : 0; // Convert duration to seconds

        // Handle Hiring Quiz Logic
        if (quizType === "hiring") {
            if (!quizDate || !quizTime) {
                return res.status(400).json({ error: "Hiring quiz requires quizDate and quizTime." });
            }

            const quizTimeInSeconds = parseInt(quizTime, 10);

            // Convert quizTime to HH:MM:SS format
            const hours = Math.floor(quizTimeInSeconds / 3600);
            const minutes = Math.floor((quizTimeInSeconds % 3600) / 60);
            const seconds = quizTimeInSeconds % 60;
            formattedTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

            // Calculate Start and End Time
            quizStartTime = moment.tz(`${quizDate} ${formattedTime}`, "YYYY-MM-DD HH:mm:ss", "Asia/Kolkata");
            quizEndTime = quizStartTime.clone().add(quizDurationInSeconds, "seconds");

            const currentTime = moment().tz("Asia/Kolkata");
            console.log("Current Time:", currentTime.format());
            console.log("Quiz Start Time:", quizStartTime.format());
            console.log("Quiz End Time:", quizEndTime.format());

            if (!quizStartTime.isValid() || !quizEndTime.isValid()) {
                console.error("Invalid quiz start or end time");
                return res.status(500).json({ error: "Failed to construct quiz start or end time." });
            }

            // Ensure quiz accessibility
            if (currentTime.isBefore(quizStartTime)) {
                return res.status(403).json({ error: "Quiz has not started yet." });
            } else if (currentTime.isAfter(quizEndTime)) {
                return res.status(403).json({ error: "Quiz has ended." });
            }
        }

        // Handle Practice Quiz Logic
        if (quizType === "practice") {
            if (!questionTimer || questions.length === 0) {
                return res.status(400).json({ error: "Invalid practice quiz settings or no questions." });
            }
        }

        // Check if user already completed the test
        const userResponse = quiz.userResponses.find((response) => response.username === username);
        if (userResponse && userResponse.completed) {
            return res.status(400).json({ error: "Test already completed." });
        }

        // Validate questions and questionsToSet
        if (!questions || questions.length === 0) {
            return res.status(400).json({ error: "No questions available for this quiz." });
        }
        if (!questionsToSet || questionsToSet > questions.length || questionsToSet <= 0) {
            return res.status(400).json({ error: "Invalid questionsToSet value." });
        }

        // Shuffle questions using seeded random function
        let seed = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const seededRandom = () => {
            const x = Math.sin(seed++) * 10000;
            return x - Math.floor(x);
        };

        const shuffledQuestions = questions
            .map((question) => ({ question, sortKey: seededRandom() }))
            .sort((a, b) => a.sortKey - b.sortKey)
            .map(({ question }) => question);

        const selectedQuestions = shuffledQuestions.slice(0, questionsToSet);

        // Group questions by sections
        const sections = [...new Set(selectedQuestions.map((q) => q.section))];
        const questionsBySection = sections.reduce((acc, section) => {
            acc[section] = selectedQuestions.filter((q) => q.section === section);
            return acc;
        }, {});

        // Return response with conditional properties
        res.json({
            quizTitle,
            quizDescription,
            quizType,
            passPercentage,
            quizDuration: quizType === "hiring" ? quizDurationInSeconds : null,
            quizStartTime: quizStartTime ? quizStartTime.toISOString() : null,
            quizEndTime: quizEndTime ? quizEndTime.toISOString() : null,
            questionTimer: quizType === "practice" ? questionTimer : null,
            quizDate: quizDate || null,
            quizTime: formattedTime || null,
            sections,
            questionsBySection,
            malpracticeLimit: quiz.malpracticeLimit || 3, // Default to 3 if not specified
        });

    } catch (error) {
        console.error("Error fetching quiz:", error.message);
        res.status(500).json({ error: "Error fetching quiz." });
    }
});











app.get('/api/quizzes/:quizId/check-access', async (req, res) => {
    const { quizId } = req.params;

    try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

        if (quiz.quizType === 'hiring') {
            const currentDateTime = new Date();
            if (currentDateTime < quiz.quizDate) {
                return res.status(403).json({ error: 'Quiz is not accessible until the scheduled date' });
            }
        }

        res.json({ accessGranted: true });
    } catch (error) {
        console.error('Error checking quiz access:', error);
        res.status(500).json({ error: 'Error checking quiz access' });
    }
});

app.get('/api/quizzes/:quizId/users/status', async (req, res) => {
    const { quizId } = req.params;
    const username = req.query.username;  // Assuming username is sent in the query

    try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        const userResponse = quiz.userResponses.find((response) => response.username === username);
        if (userResponse && userResponse.completed) {
            return res.json({ submitted: true });  // If quiz is already completed by the user
        }

        res.json({ submitted: false, quiz });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching quiz status' });
    }
});


// Example logic for handling quiz submission
app.post('/api/quizzes/:quizId/users/submit', async (req, res) => {
    const { quizId } = req.params;
    const { username, responses, totalTimeSpent } = req.body;

    const quiz = await Quiz.findById(quizId);

    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    // Check if the user has already attempted the quiz
    const userResult = quiz.userResponses.find(result => result.username === username);
    if (userResult?.hasAttempted) {
        return res.status(403).json({ message: 'User has already submitted this quiz.' });
    }

    // Calculate score based on the correct answers
    let score = 0;
    responses.forEach((response) => {
        const question = quiz.questions[response.questionIndex];
        if (!question) return;

        const correctOptionIndex = parseInt(question.correctOption, 10); // Ensure it's a number
        if (response.answer === correctOptionIndex) {
            correctAnswers += 1; // Increment score if answer matches the correct option
        }
    });



    // Update the user's quiz result and mark as attempted
    quiz.userResponses.push({
        username,
        responses,
        completed: true,
        submittedAt: new Date(),
        totalTimeSpent,
        score,
        hasAttempted: true,


    });

    await quiz.save();
    res.status(200).json({ message: 'Quiz submitted successfully', score });
});





// GET route to fetch all quizzes
app.get('/api/quizzes', async (req, res) => {
    try {
        const quizzes = await Quiz.find();
        res.json(quizzes);
    } catch (err) {
        res.status(500).json({ error: 'Error fetching quizzes' });
    }
});

// POST route to handle quiz creation
// POST route to handle quiz creation
// POST route to handle quiz creation

const convertTimeToSeconds = (timeString) => {
    if (!timeString) return 0;
    const [hours, minutes, seconds] = timeString.split(":").map(Number);
    return (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0);
};

const validateQuiz = (req, res, next) => {
    const {
        quizType,
        quizTitle,
        quizDescription,
        quizDate,
        quizTime,
        quizDuration,
        questionTimer,
        onlyCoding,
        codingQuestions = [], // Default to an empty array if undefined
        sections = [], // Default to an empty array if undefined
        sectionFeatureActive = false, // Default to false if undefined
    } = req.body;

    // Basic validations
    if (!quizTitle || !quizDescription) {
        return res.status(400).json({ error: "Quiz title and description are required." });
    }

    // Validate hiring quizzes
    if (quizType === "hiring" && !onlyCoding) {
        if (!quizDate) {
            return res.status(400).json({ error: "quizDate is required for hiring quizzes." });
        }
        if (!quizTime || !/^\d{2}:\d{2}:\d{2}$/.test(quizTime)) {
            return res.status(400).json({
                error: "quizTime is required and must be in HH:MM:SS format for hiring quizzes.",
            });
        }
        if (!quizDuration || quizDuration < 1) {
            return res.status(400).json({
                error: "quizDuration is required and must be a positive integer for hiring quizzes.",
            });
        }
    }

    // Validate section assignments if section feature is active
    // Validate section assignments if section feature is active
    if (sectionFeatureActive && Array.isArray(sections) && sections.length > 0) {
        if (!Array.isArray(codingQuestions) || codingQuestions.length === 0) {
            return res.status(400).json({
                error: "Coding questions must be provided when the section feature is active.",
            });
        }

        // Assign default sections to missing fields
        const validatedCodingQuestions = codingQuestions.map((cq) => ({
            ...cq,
            section: cq.section || "default", // Default section
        }));

        if (validatedCodingQuestions.some((cq) => !sections.includes(cq.section))) {
            return res.status(400).json({
                error: "All coding questions must be assigned to valid sections.",
            });
        }
    }
    if (codingQuestions.length > 0) {
        for (const [index, question] of codingQuestions.entries()) {
            if (
                !Array.isArray(question.privateTestCases) ||
                question.privateTestCases.some(
                    (testCase) => !testCase.input?.trim() || !testCase.output?.trim()
                )
            ) {
                return res.status(400).json({
                    error: `Private test cases for coding question ${index + 1} must include both input and output.`,
                });
            }
        }
    }

    // Validate practice quizzes
    if (quizType === "practice" && !onlyCoding) {
        if (!questionTimer || questionTimer < 1) {
            return res.status(400).json({
                error: "questionTimer is required and must be a positive integer for practice quizzes.",
            });
        }
    }

    next(); // Pass validation
};

app.post("/api/quizzes", validateQuiz, async (req, res) => {
    try {
        const {
            quizTitle,
            quizDescription,
            quizType,
            sectionFeatureActive,
            passPercentage,
            numberOfQuestions,
            questionsToSet,
            quizDate,
            quizTime,
            quizDuration,
            questionTimer,
            malpracticeLimit,
            sections = [],
            questions = [],
            codingWithQuiz,
            onlyCoding,
            codingTimer,
            codingQuestions = [],
        } = req.body;

        // Validate required fields for hiring quiz type
        if (quizType === "hiring") {
            if (!quizDate || !quizTime || (!quizDuration && !onlyCoding)) {
                return res.status(400).json({
                    error: "Hiring quizzes require quizDate, quizTime, and quizDuration (if not onlyCoding) to be set.",
                });
            }
        }

        // Validate required fields for practice quiz type
        if (quizType === "practice" && !onlyCoding) {
            if (!questionTimer || questionTimer < 1) {
                return res.status(400).json({
                    error: "For practice quizzes, a valid questionTimer is required unless onlyCoding is selected.",
                });
            }
        }

        // Validate and assign sections for non-coding questions
        let processedQuestions = [];
        if (!onlyCoding) {
            if (sections && Array.isArray(sections)) {
                const invalidQuestions = questions.filter(
                    (q) => !q.section || !sections.includes(q.section)
                );
                if (invalidQuestions.length > 0) {
                    return res.status(400).json({
                        error: "Some questions are assigned to non-existent sections.",
                        invalidQuestions: invalidQuestions.map((q) => q.question),
                    });
                }

                processedQuestions = questions.map((q) => ({
                    ...q,
                    section: q.section || "default",
                }));
            } else {
                processedQuestions = questions.map((q) => ({
                    ...q,
                    section: "default",
                }));
            }

            // Validate `correctOption` for each question
            processedQuestions.forEach((question) => {
                const correctIndex = question.correctOption;
                if (
                    correctIndex === null ||
                    correctIndex === undefined ||
                    correctIndex < 0 ||
                    correctIndex >= question.options.length
                ) {
                    throw new Error(
                        `Invalid correctOption index for question: "${question.question}".`
                    );
                }
            });
        }

        // Validate `questionsToSet`
        if (!onlyCoding && questionsToSet > numberOfQuestions) {
            return res.status(400).json({
                error: "questionsToSet cannot be greater than total numberOfQuestions.",
            });
        }

        // Validate coding questions (if applicable)
        if ((codingWithQuiz || onlyCoding) && codingQuestions) {
            codingQuestions.forEach((codingQuestion, index) => {
                if (
                    !codingQuestion.programSlug ||
                    !codingQuestion.problemName ||
                    !codingQuestion.description ||
                    !codingQuestion.problemStatement ||
                    !codingQuestion.inputFormat ||
                    !codingQuestion.outputFormat ||
                    !codingQuestion.constraints ||
                    !codingQuestion.sampleInput ||
                    !codingQuestion.sampleOutput ||
                    !Array.isArray(codingQuestion.privateTestCases) ||
                    codingQuestion.privateTestCases.some((testCase) => !testCase.trim()) // Ensure all private test cases are valid
                ) {
                    throw new Error(
                        `Coding question ${index + 1} is missing required fields or contains invalid private test cases.`
                    );
                }

                // Log a warning for invalid or missing image field (optional)
                if (!codingQuestion.image) {
                    console.warn(`Coding question ${index + 1} does not have an associated image.`);
                }
            });
        }



        // Convert quizTime to seconds for hiring quizzes
        let quizTimeInSeconds = 0;
        if (quizType === "hiring") {
            if (quizTime && typeof quizTime === "string") {
                quizTimeInSeconds = convertTimeToSeconds(quizTime);
                if (isNaN(quizTimeInSeconds)) {
                    return res.status(400).json({ error: "Invalid quizTime format. Use HH:MM:SS." });
                }
            } else {
                return res.status(400).json({ error: "quizTime must be in HH:MM:SS format for hiring quizzes." });
            }
        }

        // Check codingTimer
        if ((codingWithQuiz || onlyCoding) && (!codingTimer || isNaN(codingTimer))) {
            return res.status(400).json({
                error: "A valid coding timer is required for coding quizzes.",
            });
        }

        // Assign default sections to coding questions
        const codingQuestionsWithSections = codingQuestions.map((cq) => ({
            ...cq,
            section: sectionFeatureActive ? cq.section || "default" : "default",
            image: cq.image || null,
            privateTestCases: cq.privateTestCases.map((testCase) => ({
                input: testCase.input || '',
                output: testCase.output || '',
            })),
        }));
        
        

        // Save quiz to the database
        const quiz = new Quiz({
            quizTitle,
            quizDescription,
            quizType,
            passPercentage,
            numberOfQuestions,
            questionsToSet,
            quizDate: quizType === "hiring" ? quizDate : null,
            quizTime: quizType === "hiring" ? quizTimeInSeconds : null,
            quizDuration: quizType === "hiring" && !onlyCoding ? quizDuration : null,
            questionTimer: quizType === "practice" && !onlyCoding ? questionTimer : null,
            malpracticeLimit,
            sections: sections && sections.length > 0 ? sections : ["default"],
            questions: !onlyCoding ? processedQuestions : [],
            codingWithQuiz, // Include codingWithQuiz flag
            onlyCoding, // Include onlyCoding flag
            codingTimer: (codingWithQuiz || onlyCoding) ? codingTimer : null, // Add coding timer
            codingQuestions: codingQuestionsWithSections, // Use validated coding questions
        });

        await quiz.save();
        res.status(201).json({ message: "Quiz created successfully!", quiz });
    } catch (error) {
        console.error("Error creating quiz:", error.message);
        res.status(500).json({ error: "Failed to create quiz", details: error.message });
    }
});












// Upload images for questions
app.post('/api/upload/question', upload.single('image'), async (req, res) => {
    try {
        const result = await cloudinary.uploader.upload_stream({ folder: 'quiz/questions' }, (error, result) => {
            if (error) return res.status(500).json({ error: 'Failed to upload image to Cloudinary' });
            res.json({ imageUrl: result.secure_url });
        }).end(req.file.buffer);
    } catch (err) {
        res.status(500).json({ error: 'Failed to upload question image' });
    }
});


// Upload images for options
app.post('/api/upload/option', upload.single('image'), async (req, res) => {
    try {
        const result = await cloudinary.uploader.upload_stream({ folder: 'quiz/options' }, (error, result) => {
            if (error) return res.status(500).json({ error: 'Failed to upload image to Cloudinary' });
            res.json({ imageUrl: result.secure_url });
        }).end(req.file.buffer);
    } catch (err) {
        res.status(500).json({ error: 'Failed to upload option image' });
    }
});


// POST route to save credentials under a specific quiz
app.post('/api/quizzes/:id/credentials', async (req, res) => {
    try {
        const { id } = req.params;
        const { credentials } = req.body;

        const quiz = await Quiz.findById(id);
        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        quiz.credentials = credentials;
        await quiz.save();

        res.json({ message: 'Credentials saved successfully!', quiz });
    } catch (error) {
        console.error('Error saving credentials:', error);  // Log detailed error
        res.status(500).json({ error: 'Failed to save credentials', details: error.message });
    }
});


// GET route to fetch credentials for a specific quiz
app.get('/api/quizzes/:id/credentials', async (req, res) => {
    try {
        const quiz = await Quiz.findById(req.params.id);
        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found' });
        }
        res.json({ credentials: quiz.credentials });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching credentials' });
    }
});

// GET a specific quiz by id
app.get('/api/quizzes/:id', async (req, res) => {
    try {
        const quiz = await Quiz.findById(req.params.id);
        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found' });
        }
        res.json(quiz,
        );
    } catch (err) {
        res.status(500).json({ error: 'Error fetching quiz' });
    }
});

// DELETE route to delete a quiz
app.delete('/api/quizzes/:id', async (req, res) => {
    try {
        const deletedQuiz = await Quiz.findByIdAndDelete(req.params.id);
        if (!deletedQuiz) return res.status(404).json({ error: 'Quiz not found' });
        res.json({ message: 'Quiz deleted successfully!' });
    } catch (err) {
        res.status(500).json({ error: 'Error deleting quiz' });
    }
});

// PUT route to update a quiz
app.put('/api/quizzes/:id', async (req, res) => {
    try {
        const updatedQuiz = await Quiz.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updatedQuiz) return res.status(404).json({ error: 'Quiz not found' });
        res.json({ message: 'Quiz updated successfully!', quiz: updatedQuiz });
    } catch (err) {
        res.status(500).json({ error: 'Error updating quiz' });
    }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
