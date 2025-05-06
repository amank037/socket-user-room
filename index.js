require('dotenv').config();
const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const http = require('http')
const socketIo = require('socket.io')
const bcrypt = require('bcryptjs')

const app = express()
const server = http.createServer(app)
const io = socketIo(server)

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


const liveUsers = new Map()
let lastDbCheck = new Date(0);

app.use(express.static('public'))
app.use(cors())
app.use(express.json())

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id)

    syncUsersWithDatabase().then(() => {
        socket.emit('initialUsers', Array.from(liveUsers.values()))
    })
    
    // Handle user login
    socket.on('user_login', (user) => {
        if (user && user._id) {
            // Update the user's socket ID to show them as online
            const existingUser = liveUsers.get(user._id)
            if (existingUser) {
                existingUser.socketId = socket.id
                liveUsers.set(user._id, existingUser)
                
                // Broadcast to all clients that this user is now online
                io.emit('userUpdated', existingUser)
                console.log(`User ${user.email} is now online with socket ID: ${socket.id}`)
            }
        }
    })
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id)
        
        // Find and mark the user as offline
        for (const [userId, user] of liveUsers.entries()) {
            if (user.socketId === socket.id) {
                user.socketId = 'offline-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
                liveUsers.set(userId, user)
                
                // Broadcast to all clients that this user is now offline
                io.emit('userUpdated', user)
                console.log(`User ${user.email} is now offline`)
                break
            }
        }
    })

    socket.on('refreshUsers', async () => {
        await syncUsersWithDatabase()
        socket.emit('initialUsers', Array.from(liveUsers.values()))
    })
})

async function syncUsersWithDatabase() {
    try {
        const newOrUpdatedUsers = await User.find({
            $or: [
                { createdAt: { $gt: lastDbCheck } },
                { updatedAt: { $gt: lastDbCheck } }
            ]
        })
        
        newOrUpdatedUsers.forEach(user => {
            const liveUser = {
                _id: user._id.toString(),
                socketId: 'offline-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                email: user.email,
                name: `${user.firstName} ${user.lastName}`
            }
            
            liveUsers.set(liveUser._id, liveUser)

            io.emit('userAdded', liveUser)
        })
 
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

// Add login endpoint
app.post('/auth/login', async (req, res) => {
    try {
        const { loginId, password } = req.body
        
        // Find user by loginId
        const user = await User.findOne({ loginId })
        if (!user) {
            return res.status(401).send('Invalid login credentials')
        }
        
        // Check password (ideally this should use bcrypt)
        // For now, we'll do a simple comparison since we don't know if passwords are hashed
        const passwordMatches = password === user.password
        // If you implement bcrypt later:
        // const passwordMatches = await bcrypt.compare(password, user.password)
        
        if (!passwordMatches) {
            return res.status(401).send('Invalid login credentials')
        }
        
        // Send back user info (excluding password)
        const userInfo = {
            _id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            loginId: user.loginId
        }
        
        // Update the user's status in liveUsers map
        const liveUser = {
            _id: user._id.toString(),
            socketId: 'online-pending', // Will be updated when socket connects
            email: user.email,
            name: `${user.firstName} ${user.lastName}`
        }
        
        liveUsers.set(liveUser._id, liveUser)
        
        res.status(200).json({
            message: 'Login successful',
            user: userInfo
        })
    } catch (err) {
        res.status(500).send({
            message: 'Login failed',
            error: err.message || 'Unknown error'
        })
    }
})

// Logout endpoint
app.post('/auth/logout', (req, res) => {
    const { userId } = req.body
    
    if (userId && liveUsers.has(userId)) {
        const user = liveUsers.get(userId)
        user.socketId = 'offline-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
        liveUsers.set(userId, user)
        
        io.emit('userUpdated', user)
        res.status(200).json({ message: 'Logout successful' })
    } else {
        res.status(400).json({ message: 'User not found' })
    }
})

app.post('/users', async (req, res) => {
    try {
        const newUser = new User(req.body)
        await newUser.save()

        const liveUser = {
            _id: newUser._id.toString(),
            socketId: 'offline-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            email: newUser.email,
            name: `${newUser.firstName} ${newUser.lastName}`
        }
        
        liveUsers.set(liveUser._id, liveUser)

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

        setInterval(syncUsersWithDatabase, 30000)
    } catch (err) {
        console.error('Failed to initialize live users:', err)
    }
}

// mongoose.connect(process.env.MONGO_URI)
//     .then(() => {
//         console.log('Connected to MongoDB')
//         initializeLiveUsers()
//     })
//     .catch((err) => console.error('MongoDB connection error:', err))
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000, // 30 seconds timeout
    socketTimeoutMS: 45000, // 45 seconds socket timeout
})
.then(() => {
    console.log('Connected to MongoDB');
    initializeLiveUsers();
})
.catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1); // Exit process if can't connect
});

server.listen(3000, () => {
    console.log('Server started on port 3000')
})