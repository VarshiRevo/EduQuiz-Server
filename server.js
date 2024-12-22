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
    origin: ['https://elevatequiz.netlify.app', 'http://localhost:5173'], // Allow your frontend URL
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

        // Quiz timing validation
        if (quiz.quizType === 'hiring') {
            const quizDate = quiz.quizDate || ''; // Ensure quizDate is valid
            const quizTimeInSeconds = parseInt(quiz.quizTime, 10);

            // Format quiz start time
            const hours = Math.floor(quizTimeInSeconds / 3600);
            const minutes = Math.floor((quizTimeInSeconds % 3600) / 60);
            const seconds = quizTimeInSeconds % 60;
            const formattedTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

            const quizStartTime = moment.tz(`${quizDate} ${formattedTime}`, "YYYY-MM-DD HH:mm:ss", "Asia/Kolkata");
            const quizEndTime = quizStartTime.clone().add(quiz.quizDuration, 'minutes');
            const loginAccessStartTime = quizStartTime.clone().subtract(10, 'minutes'); // Allow login 10 mins before quiz start
            const currentTime = moment().tz('Asia/Kolkata');

            console.log("Login Start Time:", loginAccessStartTime.format());
            console.log("Quiz Start Time:", quizStartTime.format());
            console.log("Quiz End Time:", quizEndTime.format());
            console.log("Current Time:", currentTime.format());

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

    try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            console.warn(`Quiz with ID ${quizId} not found`);
            return res.status(404).json({ error: 'Quiz not found' });
        }

        console.log(`Checking credentials for username: ${username}`);
        console.log('User responses:', responses);
        console.log('Quiz questions:', quiz.questions);

        // Check if the username exists in the quiz's credentials
        const userCredential = quiz.credentials.find((cred) => cred.username === username);
        if (!userCredential) {
            console.warn(`Username ${username} not found in quiz credentials`);
            return res.status(403).json({ error: 'User is not authorized for this quiz.' });
        }

        // Check if the user already submitted the quiz
        const existingResponse = quiz.userResponses.find((response) => response.username === username);
        if (existingResponse && existingResponse.completed) {
            return res.status(400).json({ error: 'Test already submitted' });
        }

        const { questionsToSet } = quiz;

        // Validate that questionsToSet is defined and within range
        if (!questionsToSet || questionsToSet <= 0 || questionsToSet > quiz.questions.length) {
            return res.status(400).json({ error: 'Invalid questionsToSet value' });
        }

        // Calculate the number of correct answers based on `questionsToSet`
        let correctAnswers = 0;
        responses.forEach((response) => {
            const question = quiz.questions[response.questionIndex];
            if (!question) return;

            const correctOptionIndex = parseInt(question.correctOption, 10); // Ensure it's a number
            if (response.answer === correctOptionIndex) {
                correctAnswers += 1; // Increment score if the answer is correct
            }
        });

        // Calculate percentage and determine if the user passes
        const percentage = (correctAnswers / questionsToSet) * 100; // Use `questionsToSet` for the denominator
        const isPass = percentage >= quiz.passPercentage;

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
        // Log and return an error response
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

            console.log("Login Access Start Time:", loginAccessStartTime.format());
            console.log("Quiz Start Time:", quizStartTime.format());
            console.log("Quiz End Time:", quizEndTime.format());
            console.log("Current Time:", currentTime.format());

            if (currentTime.isBefore(loginAccessStartTime)) {
                return res.status(403).json({
                    error: 'The quiz is not accessible yet. Access is allowed 10 minutes before the start time.'
                });
            }

            if (currentTime.isAfter(quizEndTime)) {
                return res.status(403).json({
                    error: 'The quiz has already ended.'
                });
            }
        } else if (quiz.quizType === 'practice') {
            // For practice quizzes, no time restrictions
            quizStartTime = null;
            quizEndTime = null;
        }

        // Respond with quiz details
        res.json({
            quizTitle: quiz.quizTitle,
            quizDescription: quiz.quizDescription,
            quizType: quiz.quizType,
            questionsToSet: quiz.questionsToSet,
            timeLimit: quiz.quizDuration, // Time in minutes
            quizStartTime: quizStartTime ? quizStartTime.toISOString() : null,
            quizEndTime: quizEndTime ? quizEndTime.toISOString() : null,
            bannerImageUrl: quiz.bannerImageUrl,
            questions: quiz.questions || [], // Default to empty array if questions are not provided
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
    const { quizType, quizTitle, quizDescription, quizDate, quizTime, quizDuration, questionTimer } = req.body;

    // Basic validations
    if (!quizTitle || !quizDescription) {
        return res.status(400).json({ error: "Quiz title and description are required." });
    }

    // Validate hiring quizzes
    if (quizType === "hiring") {
        if (!quizDate) {
            return res.status(400).json({ error: "quizDate is required for hiring quizzes." });
        }
        if (!quizTime || !/^\d{2}:\d{2}:\d{2}$/.test(quizTime)) {
            return res.status(400).json({ error: "quizTime is required and must be in HH:MM:SS format for hiring quizzes." });
        }
        if (!quizDuration || quizDuration < 1) {
            return res.status(400).json({ error: "quizDuration is required and must be a positive integer for hiring quizzes." });
        }
    }

    // Validate practice quizzes
    if (quizType === "practice") {
        if (!questionTimer || questionTimer < 1) {
            return res.status(400).json({ error: "questionTimer is required and must be a positive integer for practice quizzes." });
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
            passPercentage,
            numberOfQuestions,
            questionsToSet,
            quizDate,
            quizTime,
            quizDuration,
            questionTimer,
            sections,
            questions,
        } = req.body;

        // Check if required fields for hiring quiz type are provided
        if (quizType === "hiring") {
            if (!quizDate || !quizTime || !quizDuration) {
                return res.status(400).json({
                    error: "Hiring quizzes require quizDate, quizTime, and quizDuration to be set.",
                });
            }

        }
        // Validate that all questions have valid sections
        if (quizType === "sectioned") {
            // Validate that all questions have valid sections
            const invalidQuestions = questions.filter(
                (q) => !q.section || !sections.includes(q.section)
            );
            if (invalidQuestions.length > 0) {
                return res.status(400).json({
                    error: "Some questions are assigned to non-existent sections.",
                    invalidQuestions: invalidQuestions.map((q) => q.question), // Provide details for debugging
                });
            }
        } else {
            // Default section assignment for non-sectioned quizzes
            questions.forEach((q) => {
                if (!q.section) q.section = "default";
            });
        }



        // Check if required fields for practice quiz type are provided
        if (quizType === "practice") {
            if (!questionTimer || questionTimer < 1) {
                return res.status(400).json({
                    error: "For practice quizzes, a valid questionTimer is required.",
                });
            }
        }

        let quizTimeInSeconds = 0;
        if (quizType === "hiring") {
            // Convert quizTime to seconds for hiring quizzes
            if (quizTime && typeof quizTime === "string") {
                quizTimeInSeconds = convertTimeToSeconds(quizTime);
                if (isNaN(quizTimeInSeconds)) {
                    return res.status(400).json({ error: "Invalid quizTime format. Use HH:MM:SS." });
                }
            } else {
                return res.status(400).json({ error: "quizTime is required and must be in HH:MM:SS format for hiring quizzes." });
            }
        }

        // Validate `questionsToSet` against `numberOfQuestions`
        if (questionsToSet > numberOfQuestions) {
            return res
                .status(400)
                .json({ error: "questionsToSet cannot be greater than total numberOfQuestions." });
        }

        // Validate each question's correctOption
        questions.forEach((question, qIndex) => {
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


        // Save the quiz to the database
        const quiz = new Quiz({
            quizTitle,
            quizDescription,
            quizType,
            passPercentage,
            numberOfQuestions,
            questionsToSet,
            quizDate: quizType === "hiring" ? quizDate : null,
            quizTime: quizType === "hiring" ? quizTimeInSeconds : null,
            quizDuration: quizType === "hiring" ? quizDuration : null,
            questionTimer: quizType === "practice" ? questionTimer : null,
            sections: quizType === "sectioned" ? sections : ["default"],
            questions,
        });

        await quiz.save();
        res.status(201).json({ message: "Quiz created successfully!", quiz });
    } catch (error) {
        console.error("Error creating quiz:", error.message);
        res.status(500).json({ error: "Failed to create quiz", details: error.message });
    }
});


// Helper function to convert HH:MM:SS to seconds
app.post('/api/quizzes/:quizId/users/:username/malpractice', async (req, res) => {
    const { quizId, username } = req.params;
    const { malpracticeCount } = req.body;

    try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found.' });
        }

        const userResponse = quiz.userResponses.find((response) => response.username === username);
        if (!userResponse) {
            return res.status(404).json({ error: 'User response not found for the quiz.' });
        }

        userResponse.malpracticeCount = malpracticeCount;

        await quiz.save();
        res.status(200).json({ message: 'Malpractice count updated successfully.' });
    } catch (error) {
        console.error('Error updating malpractice count:', error);
        res.status(500).json({ error: 'Failed to update malpractice count.' });
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
