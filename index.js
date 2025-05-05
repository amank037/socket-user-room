const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const http = require('http')
const socketIo = require('socket.io')
const User = require('./user.js')

const app = express()
const server = http.createServer(app)
const io = socketIo(server)

const liveUsers = new Map()

app.use(express.static('public'))
app.use(cors())
app.use(express.json())

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id)

    socket.emit('initialUsers', Array.from(liveUsers.values()))
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id)
    })
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