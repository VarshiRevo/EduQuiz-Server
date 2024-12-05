const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const Quiz = require('./models/Quiz'); // Assuming Quiz model is correctly defined

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads/questions', express.static(path.join(__dirname, 'uploads/questions')));
app.use('/uploads/options', express.static(path.join(__dirname, 'uploads/options')));

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/dbquiz', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log('Connected to MongoDB'))
    .catch((error) => console.error('Error connecting to MongoDB:', error));

// Multer Storage for Question and Option Images
const questionStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/questions/'); // Folder to store question images
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); // Set unique filename
    }
});

const optionStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/options/'); // Folder to store option images
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); // Set unique filename
    }
});

const uploadQuestionImage = multer({ storage: questionStorage });
const uploadOptionImage = multer({ storage: optionStorage });

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
  
      res.json({
        message: 'Login successful',
        quizId: quiz._id,
        username: userCredential.username,
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
    const { quizId, username } = req.params;

    try {
        console.log(`Fetching profile for quizId: ${quizId}, username: ${username}`);  // Log parameters

        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            console.warn('Quiz not found');
            return res.status(404).json({ error: 'Quiz not found' });
        }

        const userProfile = quiz.userProfiles.find((profile) => profile.username === username);
        if (!userProfile) {
            console.warn(`Profile not found for username: ${username}`);
            return res.status(404).json({ error: 'Profile not found for this username' });
        }

        res.json(userProfile);
    } catch (error) {
        console.error('Error fetching user profile:', error);  // Detailed logging
        res.status(500).json({ error: 'Error fetching user profile', details: error.message });
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
        console.log('Quiz credentials:', quiz.credentials);

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

        // Save the user response
        quiz.userResponses.push({
            username,
            responses,
            completed: true,
            submittedAt: new Date(),
            totalTimeSpent,
        });

        await quiz.save();
        console.log(`Test submitted successfully for username: ${username}`);
        res.status(200).json({ message: 'Test submitted successfully!' });
    } catch (error) {
        console.error('Error submitting test:', error);
        res.status(500).json({ error: 'Error submitting test' });
    }
});






app.get('/api/quizzes/:quizId/users/:username', async (req, res) => {
    const { quizId, username } = req.params;

    try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

        const userResponse = quiz.userResponses.find(response => response.username === username);
        if (userResponse && userResponse.completed) {
            return res.status(400).json({ error: 'Test already completed' });
        }

        // Return quiz data only if the user hasn't completed the quiz
        res.json(quiz);
    } catch (error) {
        console.error('Error fetching quiz:', error);
        res.status(500).json({ error: 'Error fetching quiz' });
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
    responses.forEach((response, index) => {
        const correctAnswer = quiz.questions[response.questionIndex].correctOption;
        if (response.answer === correctAnswer) {
            score += 1;  // Increment score if answer is correct
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
        hasAttempted: true
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
app.post('/api/quizzes', async (req, res) => {
    try {
        console.log('Request body:', req.body); // Add this line to log the request body

        const { quizTitle, quizDescription, quizType, numberOfQuestions, quizDate, quizTime, questionTimer, questions } = req.body;

        // Validate numberOfQuestions before proceeding
        if (numberOfQuestions === undefined || typeof numberOfQuestions !== 'number') {
            return res.status(400).json({ error: 'The numberOfQuestions field is required and must be a number.' });
        }

        // Create a new Quiz instance with the provided data
        const quiz = new Quiz({
            quizTitle,
            quizDescription,
            quizType,
            numberOfQuestions,
            quizDate,
            quizTime,
            questionTimer,
            questions
        });

        await quiz.save();
        res.status(201).json({ message: 'Quiz created successfully!', quiz });
    } catch (error) {
        console.error('Error creating quiz:', error);
        res.status(500).json({ error: 'Failed to create quiz', details: error.message });
    }
});



// Upload images for questions
app.post('/api/upload/question', uploadQuestionImage.single('image'), (req, res) => {
    try {
        res.json({ imageUrl: `/uploads/questions/${req.file.filename}` });
    } catch (err) {
        res.status(500).json({ error: 'Failed to upload question image' });
    }
});

// Upload images for options
app.post('/api/upload/option', uploadOptionImage.single('image'), (req, res) => {
    try {
        res.json({ imageUrl: `/uploads/options/${req.file.filename}` });
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
        res.json(quiz);
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
