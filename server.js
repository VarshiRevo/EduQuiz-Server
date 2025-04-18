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
const fs = require('fs');
const { exec } = require("child_process");
const storage = multer.memoryStorage();
const upload = multer({ storage });
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid"); // Import the uuid function
env.config();
// Middleware
app.use(cors({
    origin: ['https://elevatequiz.netlify.app', 'http://localhost:5173','https://eduacademiaquiz.netlify.app'], // Allow your frontend URL
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
            
            // MODIFIED: For onlyCoding quizzes, keep the original behavior
            // For other hiring quizzes, set a 24-hour access window
            let accessEndTime;
            if (quiz.onlyCoding) {
                accessEndTime = quizStartTime.clone().add(quiz.codingTimer * 60, 'seconds');
            } else {
                // 24-hour access window for regular hiring and codingWithQuiz
                accessEndTime = quizStartTime.clone().add(24, 'hours');
            }
            
            const loginAccessStartTime = quizStartTime.clone().subtract(10, 'minutes');
            const currentTime = moment().tz('Asia/Kolkata');

            if (currentTime.isBefore(loginAccessStartTime)) {
                return res.status(403).json({
                    error: 'The quiz is not yet accessible. Login allowed 10 minutes before the quiz start time.',
                });
            }
            if (currentTime.isAfter(accessEndTime)) {
                return res.status(403).json({
                    error: 'The quiz access window has ended.',
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
app.post('/api/quizzes/:quizId/users/:username/save-responses', async (req, res) => {
    const { quizId, username } = req.params;
    const { responses } = req.body;

    try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            console.error("Debug: Quiz not found");
            return res.status(404).json({ message: 'Quiz not found' });
        }

        const userResponse = quiz.userResponses.find((response) => response.username === username);
        if (!userResponse) {
            console.error("Debug: User response not found for username:", username);
            return res.status(404).json({ message: 'User not found for this quiz.' });
        }

        console.log("Debug: Saving responses:", responses);

        userResponse.responses = responses; // Save the quiz responses
        await quiz.save();

        res.status(200).json({ message: "Responses saved successfully" });
    } catch (error) {
        console.error("Debug: Error saving responses:", error.message);
        res.status(500).json({ error: 'Internal server error.', details: error.message });
    }
});


// Add this function before the quiz submission endpoint
// In your quiz submission route handler (app.post('/api/quizzes/:quizId/users/:username/submit')),
// Add this code right after you fetch the quiz:

// Reproduce the same shuffling logic that was used when fetching the quiz
const transformQuizData = (quiz) => {
    // Shuffle questions using seeded random function based on username
    let seed = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const seededRandom = () => {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    };

    // Skip if questionsBySection is already populated
    if (quiz.questionsBySection) return;

    const shuffledQuestions = quiz.questions
        .map((question) => ({ question, sortKey: seededRandom() }))
        .sort((a, b) => a.sortKey - b.sortKey)
        .map(({ question }) => question);

    const selectedQuestions = shuffledQuestions.slice(0, quiz.questionsToSet || quiz.questions.length);

    // Group questions by sections
    const sections = [...new Set(selectedQuestions.map((q) => q.section))];
    quiz.questionsBySection = sections.reduce((acc, section) => {
        acc[section] = selectedQuestions.filter((q) => q.section === section);
        return acc;
    }, {});
}

app.post('/api/quizzes/:quizId/users/:username/submit', async (req, res) => {
    const { quizId, username } = req.params;
    const { responses = [], codingResponses = [], timeSpent = 0 } = req.body;

    try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({ message: 'Quiz not found' });
        }

        const userResponse = quiz.userResponses.find((response) => response.username === username);
        if (!userResponse) {
            return res.status(404).json({ message: 'User not found for this quiz.' });
        }

        // Initialize scores
        let nonCodingScore = 0;
        let totalPassedTestCases = 0;
        let totalTestCases = 0;
        let nonCodingPercentage = 0;

        // Calculate non-coding score
        if (!quiz.onlyCoding && responses && responses.length > 0) {
            const totalNonCodingQuestions = quiz.questionsToSet || quiz.questions.length;
            let correctAnswers = 0;

            // Group questions by section
            const questionsBySection = {};
            quiz.questions.forEach(question => {
                if (!questionsBySection[question.section]) {
                    questionsBySection[question.section] = [];
                }
                questionsBySection[question.section].push(question);
            });

            // Process each response
            responses.forEach(response => {
                const sectionQuestions = questionsBySection[response.section];
                if (!sectionQuestions) return;

                const question = sectionQuestions[response.questionIndex];
                if (!question) return;

                const userAnswer = parseInt(response.answer);
                const correctAnswer = parseInt(question.correctOption);

                console.log(`Debug: Checking answer for question ${response.questionIndex} in section ${response.section}:`);
                console.log(`User answer: ${userAnswer}, Correct answer: ${correctAnswer}`);

                if (!isNaN(correctAnswer) && userAnswer === correctAnswer) {
                    correctAnswers++;
                }
            });

            nonCodingScore = correctAnswers;
            nonCodingPercentage = totalNonCodingQuestions > 0
                ? (correctAnswers / totalNonCodingQuestions) * 100
                : 0;

            console.log("Debug: Non-coding score calculation:", {
                correctAnswers,
                totalNonCodingQuestions,
                nonCodingPercentage
            });
        }

        // Calculate coding score
        let codingPercentage = 0;
        if (quiz.codingQuestions && quiz.codingQuestions.length > 0) {
            const codingResults = userResponse.codingResults || {};
            let totalPassed = 0;
            let totalCases = 0;

            // Calculate from stored results
            Object.values(codingResults).forEach(result => {
                if (result && typeof result.passedTestCases === 'number' && typeof result.totalTestCases === 'number') {
                    totalPassed += result.passedTestCases;
                    totalCases += result.totalTestCases;
                }
            });

            // Calculate from new submissions
            codingResponses.forEach(response => {
                const question = quiz.codingQuestions[response.questionIndex];
                if (question && question.privateTestCases) {
                    totalCases += question.privateTestCases.length;
                    totalPassed += response.passedTestCases || 0;
                }
            });

            totalPassedTestCases = totalPassed;
            totalTestCases = totalCases;
            codingPercentage = totalCases > 0 ? (totalPassed / totalCases) * 100 : 0;
        }

        // Calculate overall percentage
        const totalQuestions = (!quiz.onlyCoding ? (quiz.questionsToSet || quiz.questions.length) : 0) +
            (quiz.codingQuestions ? quiz.codingQuestions.length : 0);

        const overallPercentage = quiz.onlyCoding
            ? codingPercentage
            : quiz.codingWithQuiz
                ? ((nonCodingPercentage + codingPercentage) / 2)
                : nonCodingPercentage;

        const isPass = overallPercentage >= quiz.passPercentage;

        // Update user response
        userResponse.completed = true;
        userResponse.submittedAt = new Date();
        userResponse.totalTimeSpent = timeSpent;
        userResponse.responses = responses;
        userResponse.nonCodingScore = nonCodingScore;
        userResponse.codingScore = totalPassedTestCases;
        userResponse.totalScore = nonCodingScore + totalPassedTestCases;
        userResponse.nonCodingPercentage = nonCodingPercentage;
        userResponse.codingPercentage = codingPercentage;
        userResponse.overallPercentage = overallPercentage;
        userResponse.isPass = isPass;

        // Save the updated quiz
        await quiz.save();

        res.status(200).json({
            message: 'Quiz submitted successfully',
            overallPercentage,
            codingPercentage,
            nonCodingPercentage,
            isPass,
        });
    } catch (error) {
        console.error("Debug: Error during quiz submission:", error.message);
        res.status(500).json({ error: 'Internal server error.', details: error.message });
    }
});


app.post('/api/quizzes/:quizId/users/:username/update-results', async (req, res) => {
    const { quizId, username } = req.params;
    const { codingResults } = req.body;

    try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            console.error("Debug: Quiz not found");
            return res.status(404).json({ message: 'Quiz not found' });
        }

        const userResponse = quiz.userResponses.find((response) => response.username === username);
        if (!userResponse) {
            console.error("Debug: User response not found for username:", username);
            return res.status(404).json({ message: 'User not found for this quiz.' });
        }

        console.log("Debug: Coding results received for update:", codingResults);

        const storedCodingResults = userResponse.codingResults || {};

        // Merge new coding results into storedCodingResults
        Object.entries(codingResults).forEach(([key, result]) => {
            storedCodingResults[key] = {
                ...storedCodingResults[key],
                ...result, // Merge existing and new results
            };
        });

        // Update the user's coding results
        userResponse.codingResults = storedCodingResults;

        console.log("Debug: Updated coding results in DB:", storedCodingResults);

        await quiz.save();

        res.status(200).json({
            message: 'Coding results updated successfully',
            updatedResults: storedCodingResults,
        });
    } catch (error) {
        console.error("Debug: Error updating coding results:", error.message);
        res.status(500).json({ error: 'Internal server error.', details: error.message });
    }
});










app.post('/api/quizzes/:quizId/users/submit', async (req, res) => {
    const { quizId } = req.params;
    const { username, responses = [], codingResults = [], totalTimeSpent } = req.body;

    try {
        // Find the quiz
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({ message: 'Quiz not found' });
        }

        // Check if the user has already submitted the quiz
        const userResult = quiz.userResponses.find(result => result.username === username);
        if (userResult?.completed) {
            return res.status(403).json({ message: 'User has already submitted this quiz.' });
        }

        let score = 0;
        let codingScore = 0;
        let totalScore = 0;

        if (quiz.onlyCoding) {
            // Handle onlyCoding logic
            if (codingResults.includes('pass')) {
                codingScore = codingResults.length; // All test cases passed
                totalScore = codingScore;
            } else {
                codingScore = 0;
                totalScore = 0;
            }
        } else {
            // Calculate score for non-coding questions
            if (responses.length > 0) {
                responses.forEach((response) => {
                    const question = quiz.questions[response.questionIndex];
                    if (!question) return;

                    const correctOptionIndex = parseInt(question.correctOption, 10); // Ensure it's a number
                    if (response.answer === correctOptionIndex.toString()) {
                        score += 1; // Increment score if answer matches the correct option
                    }
                });
            }

            // Handle coding quiz results if `codingWithQuiz` is enabled
            if (quiz.codingWithQuiz && codingResults.length > 0) {
                codingResults.forEach((result) => {
                    if (result === 'pass') {
                        codingScore += 1; // Increment for passed coding questions
                    }
                });
            }

            totalScore = score + codingScore;
        }

        // Calculate percentage
        const totalQuestions = (quiz.questions.length || 0) + (quiz.codingQuestions?.length || 0);
        let percentage = 0;

        if (quiz.onlyCoding) {
            percentage = totalScore > 0 ? 100 : 0; // For onlyCoding quizzes
        } else if (totalQuestions > 0) {
            percentage = (totalScore / totalQuestions) * 100; // For mixed quizzes
        }

        // Determine pass/fail status
        const isPass = percentage >= quiz.passPercentage;

        // Update the user's quiz result and mark as completed
        quiz.userResponses.push({
            username,
            responses,
            codingResults, // Store coding validation results
            completed: true,
            submittedAt: new Date(),
            totalTimeSpent,
            score,
            codingScore,
            totalScore,
            percentage,
            isPass,
        });

        await quiz.save();
        res.status(200).json({ message: 'Quiz submitted successfully', score: totalScore, percentage, isPass });
    } catch (error) {
        console.error('Error during quiz submission:', error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
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
                name: userProfile?.name || "N/A",
                email: userProfile?.email || "N/A",
                completed: response.completed,
                isPass: response.isPass,
                correctAnswers: response.correctAnswers || 0,
                percentage: response.percentage || 0,
                totalTimeSpent: response.totalTimeSpent || 0,
                nonCodingScore: response.nonCodingScore || 0,
                codingScore: response.codingScore || 0,
                totalScore: response.totalScore || 0,
                nonCodingPercentage: response.nonCodingPercentage || 0,
                codingPercentage: response.codingPercentage || 0,
                overallPercentage: response.overallPercentage || 0,
                submittedAt: response.submittedAt ? new Date(response.submittedAt).toISOString() : "N/A",
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
            const twentyFourHoursAfterEnd = quizEndTime.clone().add(24, 'hours');

            // Validate current time
            const currentTime = moment().tz("Asia/Kolkata");

            if (currentTime.isBefore(loginAccessStartTime)) {
                return res.status(403).json({
                    error: 'The quiz is not accessible yet. Access is allowed 10 minutes before the start time.'
                });
            }

            if (currentTime.isAfter(twentyFourHoursAfterEnd)) {
                console.warn(`Quiz expired (24 hours after end) for quizId: ${quizId}`);
                return res.status(200).json({ 
                    message: 'Quiz has expired (24 hours after end)',
                    isExpired: true
                });
            }
        } else if (quiz.quizType === 'practice') {
            // For practice quizzes, no time restrictions
            quizStartTime = null;
            quizEndTime = null;
        }

        // Calculate sections and questions by section
        const sections = [...new Set(quiz.questions.map((q) => q.section || 'default'))];
        const questionsBySection = sections.reduce((acc, section) => {
            acc[section] = quiz.questions.filter((q) => q.section === section);
            return acc;
        }, {});

        // Add coding section if there are coding questions
        if (quiz.codingQuestions && quiz.codingQuestions.length > 0) {
            sections.push('coding');
            questionsBySection['coding'] = quiz.codingQuestions;
        }

        // Respond with quiz details
        res.json({
            quizTitle: quiz.quizTitle,
            quizDescription: quiz.quizDescription,
            quizType: quiz.quizType,
            questionsToSet: quiz.questionsToSet,
            timeLimit: quiz.quizDuration || "Not specified",
            quizStartTime: quizStartTime ? quizStartTime.toISOString() : null,
            quizEndTime: quizEndTime ? quizEndTime.toISOString() : null,
            bannerImageUrl: quiz.bannerImageUrl,
            questions: quiz.questions || [],
            sections,
            questionsBySection,
            isExpired: false
        });

    } catch (error) {
        console.error('Error fetching quiz:', error);
        res.status(500).json({ error: 'Failed to fetch quiz.' });
    }
});



app.post("/api/validate-code", async (req, res) => {
    const { language, code, privateTestCases, quizId, username, questionIndex } = req.body;

    try {
        // Validate required parameters
        if (!quizId || !username || questionIndex === undefined) {
            console.error("Missing required parameters: quizId, username, or questionIndex");
            return res.status(400).json({ error: "Missing required parameters: quizId, username, or questionIndex." });
        }

        const languageCommands = {
            javascript: "node",
            python: "python",
            java: "javac && java",
            c: "gcc",
            cpp: "g++",
        };

        if (!languageCommands[language]) {
            console.error("Unsupported language:", language);
            return res.status(400).json({ error: "Unsupported language." });
        }

        const fileExtensions = {
            javascript: "js",
            python: "py",
            java: "java",
            c: "c",
            cpp: "cpp",
        };

        const fileBaseName = `main_${uuidv4().replace(/-/g, "_")}`;
        const codeFile = `/tmp/${fileBaseName}.${fileExtensions[language]}`;


        // Modify code for specific languages (e.g., Java class name adjustments)
        let modifiedCode = code;
        if (language === "java") {
            const classNameRegex = /public\s+class\s+\w+/;
            const classNameMatch = code.match(classNameRegex);

            if (!classNameMatch) {
                console.error("Java code must contain a public class.");
                return res.status(400).json({ error: "Java code must contain a public class." });
            }

            modifiedCode = code.replace(classNameRegex, `public class ${fileBaseName}`);
        }

        fs.writeFileSync(codeFile, modifiedCode); // Write the code file

        let passedTestCases = 0;
        const totalTestCases = privateTestCases.length;

        for (const testCase of privateTestCases) {
            const inputFile = `/tmp/${fileBaseName}.input`;

            fs.writeFileSync(inputFile, testCase.input.trim());

            let command;
            if (language === "c" || language === "cpp") {
                command = `${languageCommands[language]} ${codeFile} -o /tmp/${fileBaseName} && /tmp/${fileBaseName} < ${inputFile}`;
            } else if (language === "java") {
                command = `${languageCommands[language].split(" && ")[0]} ${codeFile} && java -cp /tmp ${fileBaseName} < ${inputFile}`;
            } else {
                command = `${languageCommands[language]} ${codeFile} < ${inputFile}`;
            }

            try {
                const output = await new Promise((resolve, reject) => {
                    exec(command, (error, stdout, stderr) => {
                        try {
                            fs.unlinkSync(inputFile); // Cleanup input file
                        } catch (cleanupError) {
                            console.error("Error cleaning up input file:", cleanupError.message);
                        }

                        if (error) return reject(stderr || error.message);
                        resolve(stdout.trim());
                    });
                });

                if (output === testCase.output.trim()) {
                    passedTestCases++;
                }
            } catch (executionError) {
                console.error(`Error executing test case with input: ${testCase.input}`, executionError.message);
            }
        }

        try {
            if (fs.existsSync(codeFile)) fs.unlinkSync(codeFile); // Cleanup code file
            if (language === "java" && fs.existsSync(`/tmp/${fileBaseName}.class`)) {
                fs.unlinkSync(`/tmp/${fileBaseName}.class`); // Cleanup Java class file
            }
            if ((language === "c" || language === "cpp") && fs.existsSync(`/tmp/${fileBaseName}`)) {
                fs.unlinkSync(`/tmp/${fileBaseName}`); // Cleanup C/C++ executable
            }
        } catch (cleanupError) {
            console.error("Error during cleanup:", cleanupError.message);
        }

        // Fetch the quiz and update user coding results
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            console.error("Quiz not found for ID:", quizId);
            return res.status(404).json({ error: "Quiz not found." });
        }

        const userResponseIndex = quiz.userResponses.findIndex((response) => response.username === username);
        if (userResponseIndex === -1) {
            console.error("User not found in quiz for username:", username);
            return res.status(404).json({ error: "User not found for this quiz." });
        }

        const userResponse = quiz.userResponses[userResponseIndex];

        // Ensure codingResults exists
        if (!userResponse.codingResults) {
            userResponse.codingResults = {};
        }

        userResponse.codingResults[questionIndex] = {
            passedTestCases,
            totalTestCases,
        };

        // Save the updated quiz
        await quiz.save();

        res.status(200).json({
            message: "Validation completed and results saved.",
            passedTestCases,
            totalTestCases,
        });
    } catch (err) {
        console.error("Internal server error:", err.message);
        res.status(500).json({ error: "Internal server error.", details: err.message });
    }
});











app.post("/api/compile", async (req, res) => {
    const { language, code, input } = req.body;

    try {
        const languageCommands = {
            javascript: "node",
            python: "python",
            java: "javac && java",
            c: "gcc",
            cpp: "g++",
        };

        if (!languageCommands[language]) {
            return res.status(400).json({ error: "Unsupported language." });
        }

        const fileExtensions = {
            javascript: "js",
            python: "py",
            java: "java",
            c: "c",
            cpp: "cpp",
        };

        // Generate a unique filename to prevent conflicts
        const baseFileName = `main_${uuidv4().replace(/-/g, "_")}`;
        const tmpDir = "/tmp"; // Use /tmp directory for temporary files
        const codeFile = `${tmpDir}/${baseFileName}.${fileExtensions[language]}`;
        const inputFile = `${tmpDir}/${baseFileName}.input`;

        let modifiedCode = code;

        // Language-specific code adjustments
        if (language === "java") {
            const classNameRegex = /public\s+class\s+(\w+)/;
            const classNameMatch = code.match(classNameRegex);

            if (!classNameMatch) {
                return res.status(400).json({ error: "Java code must contain a public class." });
            }

            const originalClassName = classNameMatch[1];
            modifiedCode = code.replace(classNameRegex, `public class ${baseFileName}`);
        } else if (language === "c" || language === "cpp") {
            if (!code.includes("main")) {
                return res.status(400).json({ error: "C/C++ code must include a `main` function." });
            }
        }

        // Write code and input files
        fs.writeFileSync(codeFile, modifiedCode);
        fs.writeFileSync(inputFile, input.trim());

        let command;
        if (language === "c") {
            command = `${languageCommands[language]} ${codeFile} -o ${tmpDir}/${baseFileName} && ${tmpDir}/${baseFileName} < ${inputFile}`;
        } else if (language === "cpp") {
            command = `${languageCommands[language]} ${codeFile} -o ${tmpDir}/${baseFileName} && ${tmpDir}/${baseFileName} < ${inputFile}`;
        } else if (language === "java") {
            command = `javac -d ${tmpDir} ${codeFile} && java -cp ${tmpDir} ${baseFileName} < ${inputFile}`;
        } else {
            command = `${languageCommands[language]} ${codeFile} < ${inputFile}`;
        }

        // Execute the command
        exec(command, (error, stdout, stderr) => {
            try {
                // Cleanup: Delete files after execution
                if (fs.existsSync(codeFile)) fs.unlinkSync(codeFile);
                if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);

                if ((language === "c" || language === "cpp") && fs.existsSync(`${tmpDir}/${baseFileName}`)) {
                    fs.unlinkSync(`${tmpDir}/${baseFileName}`);
                }

                if (language === "java" && fs.existsSync(`${tmpDir}/${baseFileName}.class`)) {
                    fs.unlinkSync(`${tmpDir}/${baseFileName}.class`);
                }
            } catch (cleanupError) {
                console.error("Error during cleanup:", cleanupError.message);
            }

            if (error) {
                console.error("Compilation/Execution Error:", stderr || error.message);
                return res.status(200).json({ output: null, error: stderr || error.message });
            }

            res.status(200).json({ output: stdout.trim(), error: null });
        });
    } catch (err) {
        console.error("Internal Server Error:", err.message);
        res.status(500).json({ error: "Internal server error.", details: err.message });
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
            malpracticeLimit,
            onlyCoding,
            codingWithQuiz,
            codingQuestions,
            codingTimer,
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

            // Calculate Admin-set Start Time
            quizStartTime = moment.tz(`${quizDate} ${formattedTime}`, "YYYY-MM-DD HH:mm:ss", "Asia/Kolkata");
            
            // MODIFIED: For non-onlyCoding quizzes, set the window end time to 24 hours after start time
            // This is the window during which users can access the quiz
            const windowEndTime = quizStartTime.clone().add(24, "hours");
            
            if (onlyCoding) {
                // For onlyCoding, maintain original behavior with fixed start/end times
                quizEndTime = quizStartTime.clone().add(codingTimer * 60, "seconds");
            } else {
                // For regular hiring or codingWithQuiz, we're just validating the 24-hour window
                // The actual quiz duration will be handled client-side once they start
                quizEndTime = windowEndTime;
            }

            const currentTime = moment().tz("Asia/Kolkata");
            console.log("Current Time:", currentTime.format());
            console.log("Quiz Start Time:", quizStartTime.format());
            console.log("Quiz End Time:", quizEndTime.format());

            if (!quizStartTime.isValid() || !quizEndTime.isValid()) {
                console.error("Invalid quiz start or end time");
                return res.status(500).json({ error: "Failed to construct quiz start or end time." });
            }

            // MODIFIED: Check if the current time is within the 24-hour window
            if (currentTime.isBefore(quizStartTime)) {
                return res.status(403).json({ error: "Quiz has not started yet." });
            } else if (currentTime.isAfter(windowEndTime)) {
                return res.status(403).json({ error: "Quiz access window has ended." });
            }
            
            // For onlyCoding quizzes we still need to check if they're within the exact time window
            if (onlyCoding && currentTime.isAfter(quizEndTime)) {
                console.warn(`Timer expired for quizId: ${quizId}, transitioning to auto-submit.`);
                return res.status(200).json({ message: "Quiz automatically submitted as the timer expired." });
            }
        }

        let codingTimers = null;
        if (quizType === "hiring" && (onlyCoding || codingWithQuiz)) {
            // Divide coding timer equally among all coding questions
            const questionCount = codingQuestions.length;
            const timerPerQuestion = Math.floor((codingTimer * 60) / questionCount); // Calculate per-question timer in seconds

            codingTimers = codingQuestions.map(() => timerPerQuestion); // Assign the same timer to all coding questions
        } else if (quizType === "practice") {
            // For practice type quizzes, assign individual timers for each question
            codingTimers = codingQuestions.map(() =>
                quiz.codingTimer && quiz.codingTimer > 0 ? quiz.codingTimer * 60 : 300 // Default to 5 mins per question
            );
        }

        // Fetch user-specific details
        const userResponse = quiz.userResponses.find((response) => response.username === username);

        if (userResponse?.completed) {
            return res.status(400).json({ error: "Test already completed." });
        }

        // Handle only coding quizzes
        if (onlyCoding) {
            const currentTime = moment().tz("Asia/Kolkata");
            const remainingTime = Math.floor((quizEndTime - currentTime) / 1000);

            if (currentTime.isBefore(quizStartTime)) {
                return res.status(403).json({ error: "Quiz has not started yet." });
            }

            if (currentTime.isAfter(quizEndTime)) {
                console.warn(`Timer expired for quizId: ${quizId}, transitioning to auto-submit.`);
                return res.status(200).json({ message: "Quiz automatically submitted as the timer expired." });
            }

            // Respond with the remaining timer
            return res.json({
                quizTitle,
                quizDescription,
                quizType,
                onlyCoding,
                passPercentage,
                codingQuestions,
                codingTimers,
                globalTimer: Math.max(remainingTime, 0),
                codingResults: userResponse?.codingResults || {}, // Include coding results
                quizDuration: quizType === "hiring" ? quizDurationInSeconds : null,
                quizStartTime: quizStartTime ? quizStartTime.toISOString() : null,
                quizEndTime: quizEndTime ? quizEndTime.toISOString() : null,
                malpracticeLimit: malpracticeLimit || 3,
            });
        }

        // Handle quizzes with coding and regular questions
        if (codingWithQuiz || (!onlyCoding && !codingWithQuiz)) {
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

            // MODIFIED: For non-onlyCoding hiring quizzes, send the full quiz duration instead of precomputed end time
            // This allows the client to start the timer when the user enters the quiz
            return res.json({
                quizTitle,
                quizDescription,
                quizType,
                passPercentage,
                codingWithQuiz,
                onlyCoding,
                quizDuration: quizDurationInSeconds, // Always send the full duration in seconds
                accessWindowStart: quizStartTime ? quizStartTime.toISOString() : null,
                accessWindowEnd: quizEndTime ? quizEndTime.toISOString() : null,
                // No longer sending specific end time - client will calculate based on when user starts
                questionTimer: quizType === "practice" ? questionTimer : null,
                quizDate: quizDate || null,
                quizTime: formattedTime || null,
                sections,
                questionsBySection,
                codingQuestions: codingWithQuiz ? codingQuestions : null, // Include coding questions if applicable
                codingTimers,
                codingResults: userResponse?.codingResults || {}, // Include coding results for codingWithQuiz
                malpracticeLimit: malpracticeLimit || 3,
            });
        }
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
    const { username, responses, codingResults, totalTimeSpent } = req.body;

    try {
        // Find the quiz
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({ message: 'Quiz not found' });
        }

        // Check if the user has already attempted the quiz
        const userResult = quiz.userResponses.find(result => result.username === username);
        if (userResult?.completed) {
            return res.status(403).json({ message: 'User has already submitted this quiz.' });
        }

        let score = 0;
        let codingScore = 0;

        // Calculate score for non-coding questions
        if (responses) {
            responses.forEach((response) => {
                const question = quiz.questions[response.questionIndex];
                if (!question) return;

                const correctOptionIndex = parseInt(question.correctOption, 10); // Ensure it's a number
                if (response.answer === correctOptionIndex.toString()) {
                    score += 1; // Increment score if answer matches the correct option
                }
            });
        }

        // Handle coding quiz validation results
        if (quiz.onlyCoding || quiz.codingWithQuiz) {
            if (codingResults) {
                codingResults.forEach((result) => {
                    if (result === 'pass') {
                        codingScore += 1; // Increment coding score for passed test cases
                    }
                });
            }
        }

        const totalScore = score + codingScore;

        // Calculate percentage
        const totalQuestions = (quiz.questions.length || 0) + (quiz.codingQuestions?.length || 0);
        const percentage = totalQuestions > 0 ? (totalScore / totalQuestions) * 100 : 0;

        // Determine pass/fail status
        const isPass = percentage >= quiz.passPercentage;

        // Update the user's quiz result and mark as completed
        quiz.userResponses.push({
            username,
            responses,
            codingResults, // Store coding validation results
            completed: true,
            submittedAt: new Date(),
            totalTimeSpent,
            score,
            codingScore,
            totalScore,
            percentage,
            isPass,
        });

        await quiz.save();
        res.status(200).json({ message: 'Quiz submitted successfully', score: totalScore, percentage, isPass });
    } catch (error) {
        console.error('Error during quiz submission:', error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
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
        codingWithQuiz,
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
        // Ensure coding questions are allowed for quizzes with coding
        if (!onlyCoding && !codingWithQuiz && codingQuestions.length > 0) {
            return res.status(400).json({
                error: "Coding questions are not allowed for practice quizzes with sections when neither onlyCoding nor codingWithQuiz is enabled.",
            });
        }

        // Assign default sections to coding questions if applicable
        if (codingWithQuiz || onlyCoding) {
            const validatedCodingQuestions = codingQuestions.map((cq) => ({
                ...cq,
                section: cq.section || "default", // Assign "default" if no section is specified
            }));

            // Ensure all coding questions belong to valid sections
            if (validatedCodingQuestions.some((cq) => !sections.includes(cq.section))) {
                return res.status(400).json({
                    error: "All coding questions must be assigned to valid sections.",
                });
            }
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
                    codingQuestion.privateTestCases.some(
                        (testCase) =>
                            !testCase.input.trim() || // Validate `input` is not empty or only whitespace
                            !testCase.output.trim() // Validate `output` is not empty or only whitespace
                    )
                ) {
                    throw new Error(
                        `Coding question ${index + 1} is missing required fields or contains invalid private test cases.`
                    );
                }

                // Log a warning for missing or invalid image field (optional)
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
