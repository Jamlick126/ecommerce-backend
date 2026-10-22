const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { createClient} = require('@supabase/supabase-js');
const WebSocket = require('ws');
require('dotenv').config();


const app = express();
const PORT = process.env.PORT || 5000;


// Middleware
app.use(cors(
    {
    origin: '*', // Allows requests from your Vercel frontend (or any presentation client)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-store-slug']
}
));
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

// 1. Supabase CLient(Connects to your central registry database containing customer connection strings)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket } // Disables WebSocket requirements for Node 20
});

// 2. Tenant Middleware: Attaches the correct DB pool based on header
const tenantDbMiddleware = async (req, res, next) => {
    const storeSlug = req.headers['x-store-slug'] || req.query.store_slug || 'default-store';
    try {
        // Verify store ecosystem exists in master_stores
        const { data, error } = await supabase
            .from('master_stores')
            .select('store_slug')
            .eq('store_slug', storeSlug)
            .single();

        if (error || !data) {
            return res.status(404).json({ message: "Store ecosystem not found" });
        }

        req.storeSlug = storeSlug;
        next();
    } catch (err) {
        console.error("Tenant DB Middleware Error:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
};

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


// 3. Public route to fetch store branding/config from Master DB
app.get('/api/store-config/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const { data, error } = await supabase
            .from('master_stores')
            .select('*')
            .eq('store_slug', slug)
            .single();
        if (error || !data) {
            return res.status(404).json({ message: "Store not found" });
        }
        res.json(data);
    } catch (err) {
        console.error("Store Config Error:", err.message);
        res.status(500).send('Server Error');
    }
});

// 4. Protected/Tenant-specific routes use tenantDbMiddleware
app.get('/api/products', tenantDbMiddleware, async (req, res) => {
    try {
        // Fetch products using Supabase client over HTTPS
        const { data, error } = await supabase
            .from('products')
            .select('*');

        if (error) {
            console.error("Supabase Error:", error);
            return res.status(500).json({ message: error.message });
        }

        res.json(data);
    } catch (err) {
        console.error("Products Route Error:", err.message);
        res.status(500).send('Server Error');
    }
});

// Route to GET single products
app.get('/api/products/:id', tenantDbMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { data: product, error } = await supabase
            .from('products')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !product) {
            return res.status(404).json({ message: "Product not found" });
        }
        res.json(product);
    } catch (err) {
        console.error("Products Route Error:", err.message);
        res.status(500).send("Server Error");
    }
});

// Route: POST register a new user
app.post('/api/register', tenantDbMiddleware, async (req, res) => {
    try {
        const { username, email, password } = req.body;
        // Hash password 
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insert into PostgreSQL
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

// Route POST login
app.post('/api/login',tenantDbMiddleware, async (req, res) => {
    try {
        const { email, password } = req.body;
        // Look for user in the database
       
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(401).json({ message: "Invalid Email or Password" });
        }
        
        const validPassword = await bcrypt.compare(password, user.password_hash);
        // Check if the password matches replace with bcrypt
        if (validPassword) {
            // Generate a JWT Token
            const token = jwt.sign(
                { id: user.id, email: user.email},
                process.env.JWT_SECRET || "My_secret_key",
                { expiresIn: '1h' }
            )
            res.json({
                message: "Login Successful!",
                token: token,
                user: { username: user.username, email: user.email }
            })
        } else {
            res.status(401).json({ message: "Invalid Email or Password"});
        }
    } catch (err) {
        console.error("Login Error:", err.message);
        res.status(500).json({message: "Server Error"});
    }
});

// Route to POST items to the cart
app.post('/api/cart',tenantDbMiddleware, async (req, res) => {
    try {
        const { username, productId, quantity } = req.body;

        // get user ID from username
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('username', username)
            .single();

        if (userError || !user) return res.status(404).json({ message: "User not found" });

        // Upsert cart item
        const { data, error } = await supabase
            .from('cart')
            .upsert(
                { user_id: user.id, product_id: productId, quantity },
                { onConflict: 'user_id, product_id' }
            )
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);  
    } catch (err) {
        console.error("Cart Route Error:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
});

// ROute to GET user's cart
app.get('/api/cart/user/:username', tenantDbMiddleware, async (req, res) => {
    try {
        const { username } = req.params;
        // Get user ID first
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('username', username)
            .single();

        if (userError || !user) return res.status(404).json({ message: "User not found" });

        // Fetch cart items joined with products
        const { data: cartItems, error } = await supabase
            .from('cart')
            .select(`
                id,
                quantity,
                products (
                    name,
                    price,
                    image_url
                )
            `)
            .eq('user_id', user.id);

        if (error) throw error;

        // Format to match expected frontend structure flattening the product join
        const formattedCart = cartItems.map(item => ({
            id: item.id,
            name: item.products?.name,
            price: item.products?.price,
            quantity: item.quantity,
            image_url: item.products?.image_url
        }));

        res.json(formattedCart);
    } catch (err) {
        console.error("Cart Route Error:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
});

// Route to get total number of items in the cart
app.get('/api/cart/count/:username',tenantDbMiddleware, async (req, res) => {
    try {
        const { username } = req.params;
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('username', username)
            .single();

        if (userError || !user) return res.json({ count: 0 });

        const { data: cartItems, error } = await supabase
            .from('cart')
            .select('quantity')
            .eq('user_id', user.id);

        if (error) throw error;

        const totalCount = cartItems.reduce((acc, curr) => acc + curr.quantity, 0);
        res.json({ count: totalCount });
    } catch (err) {
        console.error("Cart Route Error:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
});

// Route to DELETE 
app.delete('/api/cart/:id',tenantDbMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from('cart')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ message: "Item removed from cart" });
    } catch (err) {
        console.error("Cart Route Error:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
});

// Route to PUT quantity + / -
app.put ('/api/cart/update-quantity/:id',tenantDbMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { change } = req.body;
        
        // Fetch current quantity first to apply GREATEST logic safely
        const { data: currentItem, error: fetchError } = await supabase
            .from('cart')
            .select('quantity')
            .eq('id', id)
            .single();

        if (fetchError || !currentItem) return res.status(404).json({ message: "Cart item not found" });

        const newQuantity = Math.max(1, currentItem.quantity + change);

        const { data, error } = await supabase
            .from('cart')
            .update({ quantity: newQuantity })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
        
    } catch (err) {
        console.error("Cart Route Error:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
});


// STK Push Route
app.post('/api/stkpush',tenantDbMiddleware, async (req, res) => {
    const { phone, amount, username } = req.body;
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
            /*"CallBackURL": `https://unreleasing-ascogenous-bev.ngrok-free.dev/api/callback?store_slug=${req.storeSlug}`,*/
            "CallBackURL": `https://ecommerce-backend-hm0b.onrender.com/api/callback?store_slug=${req.storeSlug}`,
            "AccountReference": "RedStore",
            "TransactionDesc": "Payment for goods"
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (response.data.ResponseCode === "0") {
            const checkoutID = response.data.CheckoutRequestID;

            await supabase
                .from('orders')
                .insert([{ username, checkout_request_id: checkoutID, amount, status: 'pending' }]);
        }
        res.status(200).json(response.data);
    } catch (err) {
        res.status(500).json(err.message);
    }

})

// STK Callback
app.post('/api/callback',tenantDbMiddleware, async (req, res) => {
    const callbackData = req.body.Body.stkCallback;
    const resultCode = callbackData.ResultCode;
    const checkoutID = callbackData.CheckoutRequestID;

    try {
        if (resultCode === 0) {
            const amount = callbackData.CallbackMetadata.Item[0].Value;
            const mpesaReceipt = callbackData.CallbackMetadata.Item[1].Value;
            
            const { data: order, error: orderError } = await supabase
                .from('orders')
                .select('username')
                .eq('checkout_request_id', checkoutID)
                .single();

            if (order && !orderError) {
                const username = order.username;

                // Update order status to paid
                await supabase
                    .from('orders')
                    .update({ status: 'paid', mpesa_receipt: mpesaReceipt })
                    .eq('checkout_request_id', checkoutID);

                // Get user ID and clear cart
                const { data: user } = await supabase
                    .from('users')
                    .select('id')
                    .eq('username', username)
                    .single();

                if (user) {
                    await supabase
                        .from('cart')
                        .delete()
                        .eq('user_id', user.id);
                }
                console.log(`Cart cleared and order marked as paid for ${username}`);
            }
        } else {
            console.log(`Payment failed for Request: ${checkoutID}. Code: ${resultCode}`);
            await supabase
                .from('orders')
                .update({ status: 'failed' })
                .eq('checkout_request_id', checkoutID);
        }
    } catch (dbErr) {
        console.error("Database Callback Error:", dbErr.message);
    }
    res.status(200).send("Success");  
    
})


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});