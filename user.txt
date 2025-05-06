const mongoose = require('mongoose');

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

module.exports = mongoose.model('User', userSchema);