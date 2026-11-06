const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

// Register a new user
router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const { data, error } = await supabase
            .from('users')
            .insert([{ username, email, password_hash: hashedPassword }])
            .select()
            .single();

        if (error) {
            return res.status(500).json({ message: error.message || "Registration failed. Email or Username already exists." });
        }

        res.json({ message: "User registered successfully!", user: data });
    } catch (err) {
        console.error("Registration Error:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
});

// User login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(401).json({ message: "Invalid Email or Password" });
        }
        
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (validPassword) {
            const token = jwt.sign(
                { id: user.id, email: user.email },
                process.env.JWT_SECRET || "My_secret_key",
                { expiresIn: '1h' }
            );
            res.json({
                message: "Login Successful!",
                token: token,
                user: { username: user.username, email: user.email }
            });
        } else {
            res.status(401).json({ message: "Invalid Email or Password" });
        }
    } catch (err) {
        console.error("Login Error:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
});

module.exports = router;