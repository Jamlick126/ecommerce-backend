const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();


const app = express();
const PORT = process.env.PORT || 5000;
const axios = require('axios');

// Middleware
app.use(cors());
app.use(express.json());

//Middleware to verify JWT
const verifyToken = ( req, res, next) => {
    const token = req.headers['authorization'];

    if(!token) {
        return res.status(403).json({ message: "No token provided"});
    }
    try {
        const decoded = jwt.verify(token.split(" ")[1], process.env.JWT_SECRET  || "My_secret_key");
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: "Unauthorized: Invalid token "});
    }
};

//Supabase Connection
const pool = new Pool ({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Helper to get M-pesa Token
const getMpesaToken = async (next) => {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    try {
        const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: {
                Authorization: `Basic ${auth}`
            }
        });
        return response.data.access_token;
    } catch (err) {
        console.error("Token Generation Error:", err.response ? err.response.data : err.message);
        throw new Error("Failed to get M-Pesa Token");
    }
};

// Test Database Connection
pool.connect((err) => {
    if(err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Connected to the database')
    }
});

// Route to GET all products
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM products");
        res.json(result.rows)
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Route to GET single products
app.get('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const product = await pool.query("SELECT * FROM products WHERE id = $1", [id]);

        if (product.rows.length === 0) {
            return res.status(404).json({ message: "Product not found"});
        }
        res.json(product.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Route: POST register a new user
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Hash password 
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insert into PostgreSQL
        const newUser = await pool.query(
            "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING *",
            [username, email, hashedPassword]
        );
        res.json({message: "User registered successfully!", user: newUser.rows[0]});
    } catch (err) {
        console.error(err.message);
        res.status(500).json("Registration failed. Email or Username already exists.");
    }
});

// Route POST login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        // Look for user in the database
        const user = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

        if (user.rows.length === 0) {
            return res.status(401).json({message: "Invalid Email or Password" });
        }
        
        const validPassword = await bcrypt.compare(password, user.rows[0].password_hash);
        // Check if the password matches replace with bcrypt
        if (validPassword) {
            // Generate a JWT Token
            const token = jwt.sign(
                { id: user.rows[0].id, email: user.rows[0].email},
                process.env.JWT_SECRET || "My_secret_key",
                { expiresIn: '1h' }
            )
            res.json({
                message: "Login Successful!",
                token: token,
                user: { username: user.rows[0].username, email: user.rows[0].email }
            })
        } else {
            res.status(401).json({ message: "Invalid Email or Password"});
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).json({message: "Server Error"});
    }
});

// Route to POST items to the cart
app.post('/api/cart', async (req, res) => {
    try {
        const { username, productId, quantity } = req.body;

        // get user ID from username
        const userRes = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
        if (userRes.rows.length === 0) return res.status(404).json("User not found");

        const userId = userRes.rows[0].id;

        const result = await pool.query(
            `INSERT INTO cart (user_id, product_id, quantity) 
             VALUES($1, $2, $3) 
             ON CONFLICT (user_id, product_id) 
             DO UPDATE SET quantity = cart.quantity + $3 RETURNING *`,
            [userId, productId, quantity]
        );
        res.status(201).json(result.rows[0]);   
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ROute to GET user's cart
app.get('/api/cart/user/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const cartItems = await pool.query(
            `SELECT 
            cart.id, 
            products.name, 
            products.price, 
            cart.quantity,
            products.image_url
            FROM cart
            JOIN users ON cart.user_id = users.id
            JOIN products ON cart.product_id = products.id
            WHERE users.username = $1`,
            [username]
        );
        res.json(cartItems.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Route to get total number of items in the cart
app.get('/api/cart/count/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const result = await pool.query(
            `SELECT SUM(quantity) as total_count 
            FROM cart
            JOIN users ON cart.user_id = users.id
            WHERE users.username = $1`,
            [username]
        );
        // if cart is empty, SUM returns null so we return 0
        const count = result.rows[0].total_count || 0;
        res.json({ count: parseInt(count) });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Route to DELETE 
app.delete('/api/cart/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("DELETE FROM cart WHERE id = $1", [id]);
        res.json({ message: "Item removed from cart"});
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Route to PUT quantity + / -
app.put ('/api/cart/update-quantity/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { change } = req.body;
        
        // update quantity and ensure it never goes below 1
        const result = await pool.query(
            "UPDATE cart SET quantity = GREATEST(1, quantity + $1) WHERE id = $2 RETURNING *",
            [change, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error (err.message);
        res.status(500).send("Server Error");
    }
});

// STK Push Route
app.post('/api/stkpush', async (req, res) => {
    const { phone, amount } = req.body;
    const token = await getMpesaToken();
    const date = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const shortcode = "174379"; // Sandbox Till
    const passkey = process.env.MPESA_PASSKEY;
    const password = Buffer.from(shortcode + passkey + date).toString('base64');

    try {
        const response = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
            "BusinessShortCode": shortcode,
            "Password": password,
            "Timestamp": date,
            "TransactionType": "CustomerPayBillOnline",
            "Amount": amount,
            "PartyA": phone, // e.g., 254712345678
            "PartyB": shortcode,
            "PhoneNumber": phone,
            "CallBackURL": "https://unreleasing-ascogenous-bev.ngrok-free.dev/api/callback",
            "AccountReference": "RedStore",
            "TransactionDesc": "Payment for goods"
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (response.data.ResponseCode === "0") {
            const { username } = req.body;
            const checkoutID = response.data.CheckoutRequestID;

            await pool.query(
                "INSERT INTO orders (username, checkout_request_id, amount, status) VALUES ($1, $2, $3, $4)",
                [username, checkoutID, amount, 'pending']
            );
        }

        res.status(200).json(response.data);
    } catch (err) {
        res.status(500).json(err.message);
    }

})

// STK Callback
app.post('/api/callback', async (req, res) => {
    const callbackData = req.body.Body.stkCallback;
    const resultCode = callbackData.ResultCode;
    const checkoutID = callbackData.CheckoutRequestID;

    if (resultCode === 0) {
        // resultcode 0 means success!
        const amount = callbackData.CallbackMetadata.Item[0].Value;
        const mpesaReceipt = callbackData.CallbackMetadata.Item[1].Value;
        
        try {
            const orderRes = await pool.query("SELECT username FROM orders WHERE checkout_request_id = $1", [checkoutID]);

            if (orderRes.rows.length > 0) {
                const username = orderRes.rows[0].username;

                // update order status
                await pool.query(
                    "UPDATE orders SET status = 'paid', mpesa_receipt = $1 WHERE checkout_request_id = $2",
                    [mpesaReceipt, checkoutID]
                );
                // clear user's cart
                await pool.query(
                    "DELETE FROM cart WHERE user_id = (SELECT id FROM users WHERE username = $1)",
                    [username]
                );
                console.log(`Cart cleared and order marked as paid for ${username}`);
            }
        } catch (dbErr) {
            console.error("Database Update Error:", dbErr.message);
        }
    } else {
        console.log(`Payment failed for Request: ${checkoutID}. Code: ${resultCode}`);
        await pool.query("UPDATE orders SET status = 'failed' WHERE checkout_request_id = $1", [checkoutID]);
    }
    res.status(200).send("Success");
})

app.post('/api/intasend-webhook', async (req, res) => {
    const { invoice_id, state, api_ref } = req.body;

    // 'state' will be 'COMPLETE' for successful payments
    if (state === 'COMPLETE') {
        try {
            // Use api_ref or other metadata to identify the user
            // Example: Update your DB to mark order as paid
            await pool.query(
                "UPDATE orders SET status = 'paid' WHERE invoice_id = $1",
                [invoice_id]
            );
            if (api_ref) {
                await pool.query(
                    "DELETE FROM cart WHERE user_id = (SELECT id FROM users WHERE username = $1)",
                    [api_ref]
                );
                console.log(`IntaSend Success: Cart cleared for user ${api_ref}`);
            }
        } catch (err) {
            console.error("Webhook DB Error:", err.message);
        }
    }
    res.sendStatus(200); // Always tell IntaSend you received the message
});


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});