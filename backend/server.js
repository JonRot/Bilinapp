// Import dependencies
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

// Create an Express application
const app = express();
const server = http.createServer(app); // Create a server for Socket.IO
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // Adjust based on your frontend's address
    methods: ["GET", "POST"]
  }
}); // Attach Socket.IO to the server

// Middleware setup
app.use(cors());
app.use(bodyParser.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('Connected to MongoDB'))
  .catch((error) => console.error('Failed to connect to MongoDB', error));

// Define schemas for user and chat messages
const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, required: true }
});

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

// Create models from the schemas
const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// Function to initialize default users
const initializeDefaultUsers = async () => {
  const defaultUsers = [
    { firstName: 'Admin', lastName: 'User', email: 'admin@example.com', password: 'admin123', role: 'Admin' },
    { firstName: 'Teacher', lastName: 'User', email: 'teacher@example.com', password: 'teacher123', role: 'Teacher' },
    { firstName: 'Parent', lastName: 'User', email: 'parent@example.com', password: 'parent123', role: 'Parent' }
  ];

  for (let userData of defaultUsers) {
    try {
      const existingUser = await User.findOne({ email: userData.email });
      if (!existingUser) {
        userData.password = await bcrypt.hash(userData.password, 10);
        const newUser = new User(userData);
        await newUser.save();
        console.log(`Created default user: ${userData.email}`);
      }
    } catch (error) {
      console.error('Error initializing default users:', error);
    }
  }
};

// Call the function to initialize default users AFTER MongoDB connection is established
mongoose.connection.once('open', () => {
  initializeDefaultUsers();
});

// Route to handle user signup
app.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, role } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role,
    });

    await newUser.save();
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    console.error('Error during signup:', error);
    res.status(500).json({ message: 'Server error during signup' });
  }
});

// Route to handle user login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Check if the user exists
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Compare the provided password with the stored hashed password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Return success and the user data, including the role
    res.status(200).json({ message: 'Login successful', user });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Route to fetch all users
app.get('/chat/users', async (req, res) => {
  try {
    const users = await User.find({}, 'firstName lastName email role'); // Select only necessary fields
    res.status(200).json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// Route to fetch teachers assigned to a parent
app.get('/chat/teachers', async (req, res) => {
  try {
    const teachers = await User.find({ role: 'Teacher' });
    res.status(200).json(teachers);
  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({ message: 'Error fetching teachers' });
  }
});

// Route to fetch parents assigned to a teacher
app.get('/chat/parents', async (req, res) => {
  try {
    const parents = await User.find({ role: 'Parent' });
    res.status(200).json(parents);
  } catch (error) {
    console.error('Error fetching parents:', error);
    res.status(500).json({ message: 'Error fetching parents' });
  }
});

// Route to fetch messages between two users
app.get('/chat/messages/:otherUserId', async (req, res) => {
  const { otherUserId } = req.params;
  const { currentUserId } = req.query;

  try {
    const messages = await Message.find({
      $or: [
        { sender: currentUserId, receiver: otherUserId },
        { sender: otherUserId, receiver: currentUserId }
      ]
    }).populate('sender receiver', 'firstName lastName');

    res.status(200).json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ message: 'Error fetching messages' });
  }
});

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('sendMessage', async ({ senderId, receiverId, content }) => {
    try {
      const message = new Message({
        sender: senderId,
        receiver: receiverId,
        content,
      });
      await message.save();

      io.emit('receiveMessage', {
        senderId,
        receiverId,
        content,
        timestamp: message.timestamp,
      });
    } catch (error) {
      console.error('Error handling sendMessage event:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
