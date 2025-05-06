const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const http = require('http')
const socketIo = require('socket.io')

const app = express()
const server = http.createServer(app)
const io = socketIo(server)

// Define User schema directly in server.js
const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: true
    },
    lastName: {
        type: String,
        required: true
    },
    mobile: {
        type: String,
        required: true,
        validate: {
            validator: function(value) {
                return /^[0-9]{10}$/.test(value);
            },
            message: 'Mobile number must be 10 digits'
        }
    },
    email: {
        type: String,
        required: true,
        unique: true, 
        validate: {
            validator: function(value) {
                return /^\S+@\S+\.\S+$/.test(value);
            },
            message: 'Invalid email format'
        }
    },
    address: {
        street: String,
        city: String,
        state: String,
        country: String,
    },
    loginId: {
        type: String,
        required: true,
        minlength: 8, 
        maxlength: 20,
        unique: true
    },
    password: {
        type: String,
        required: true,
        validate: {
            validator: function(value) {
                return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\W).{6,}$/.test(value);
            },
            message: 'Password must be at least 6 characters long, contain 1 uppercase letter, 1 lowercase letter, and 1 special character'
        }
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Local storage for tracking live users with last DB check timestamp
const liveUsers = new Map()
let lastDbCheck = new Date(0); // Initialize to past date

app.use(express.static('public'))
app.use(cors())
app.use(express.json())

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id)
    
    // Check for new users on each new connection
    syncUsersWithDatabase().then(() => {
        // Send current live users list to new connections
        socket.emit('initialUsers', Array.from(liveUsers.values()))
    })
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id)
    })
    
    // Add a manual refresh handler
    socket.on('refreshUsers', async () => {
        await syncUsersWithDatabase()
        socket.emit('initialUsers', Array.from(liveUsers.values()))
    })
})

// Function to sync users from database
async function syncUsersWithDatabase() {
    try {
        // Find users created or updated since last check
        const newOrUpdatedUsers = await User.find({
            $or: [
                { createdAt: { $gt: lastDbCheck } },
                { updatedAt: { $gt: lastDbCheck } }
            ]
        })
        
        // Add new users to our live users map
        newOrUpdatedUsers.forEach(user => {
            const liveUser = {
                _id: user._id.toString(),
                socketId: 'offline-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                email: user.email,
                name: `${user.firstName} ${user.lastName}`
            }
            
            liveUsers.set(liveUser._id, liveUser)
            
            // Broadcast new user to all connected clients
            io.emit('userAdded', liveUser)
        })
        
        // Set current time as last checked time
        lastDbCheck = new Date()
        
        if (newOrUpdatedUsers.length > 0) {
            console.log(`Found and synced ${newOrUpdatedUsers.length} new or updated users`)
        }
        
        return newOrUpdatedUsers
    } catch (err) {
        console.error('Failed to sync users with database:', err)
        return []
    }
}

// Add users to live_users room when created through this API
app.post('/users', async (req, res) => {
    try {
        const newUser = new User(req.body)
        await newUser.save()

        // Add user to live_users
        const liveUser = {
            _id: newUser._id.toString(),
            socketId: 'offline-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            email: newUser.email,
            name: `${newUser.firstName} ${newUser.lastName}`
        }
        
        liveUsers.set(liveUser._id, liveUser)
        
        // Broadcast new user to all connected clients
        io.emit('userAdded', liveUser)
        
        res.status(201).send({ message: 'user created'})
    } catch (err) {
        res.status(400).send({
            message: 'failed to create user',
            error: err.message || 'unknown error'
        })
    }
})

app.get('/', (req, res) => {
    res.send('Server is working')
})

app.get('/users', async (req, res) => {
    try {
        const users = await User.find()
        res.json(users)
    } catch (error) {
        res.status(500).json({message: "Failed to retrieve users", error: error.message})
    }
})

// Endpoint to manually trigger a database sync
app.get('/sync-users', async (req, res) => {
    try {
        const newUsers = await syncUsersWithDatabase()
        res.json({
            message: `Synced ${newUsers.length} users`,
            totalUsers: liveUsers.size
        })
    } catch (error) {
        res.status(500).json({message: "Failed to sync users", error: error.message})
    }
})

// New endpoint to get a specific user by id
app.get('/users/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
        if (!user) {
            return res.status(404).json({message: "User not found"})
        }
        res.json(user)
    } catch (error) {
        res.status(500).json({message: "Failed to retrieve user", error: error.message})
    }
})

// Initialize live users from database on server start
async function initializeLiveUsers() {
    try {
        const users = await User.find()
        users.forEach(user => {
            const liveUser = {
                _id: user._id.toString(),
                socketId: 'offline-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                email: user.email,
                name: `${user.firstName} ${user.lastName}`
            }
            liveUsers.set(liveUser._id, liveUser)
        })
        console.log(`Initialized ${liveUsers.size} users in live_users room`)
        
        // Set up periodic sync (every 30 seconds)
        setInterval(syncUsersWithDatabase, 30000)
    } catch (err) {
        console.error('Failed to initialize live users:', err)
    }
}

mongoose.connect('mongodb+srv://amankhanapp:aman54321@cluster0.sk7quy9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0')
    .then(() => {
        console.log('Connected to MongoDB')
        initializeLiveUsers()
    })
    .catch((err) => console.error('MongoDB connection error:', err))

server.listen(3000, () => {
    console.log('Server started on port 3000')
})