const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const supabase = require('./config/supabase');
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

// Tenant Middleware: Attaches the correct DB pool based on header
const tenantDbMiddleware = async (req, res, next) => {
    const storeSlug = req.headers['x-store-slug'] || req.query.store_slug || 'default-store';
    try {
        // Verify store ecosystem exists in master_stores
        const { data, error } = await supabase
            .from('master_stores')
            .select('store_slug')
            .eq('store_slug', storeSlug)
            .single();
        
        // If the custom slug isn't found in master_stores, force fallback to 'default-store'
        if (error || !data) {
            storeSlug = 'default-store';
            const defaultCheck = await supabase
                .from('master_stores')
                .select('store_slug')
                .eq('store_slug', storeSlug)
                .single();
            
            if (defaultCheck.error) {
                return res.status(404).json({ message: "Default store ecosystem not found" });
            }
        }
        req.storeSlug = storeSlug;
        next();
    } catch (err) {
        console.error("Tenant DB Middleware Error:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
};

// Mount Routers (with Tenant Middleware applied where needed)
const productRoutes = require('./routes/products');
const authRoutes = require('./routes/auth');
const cartRoutes = require('./routes/cart');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');

app.use('/api', productRoutes); // Public & config routes
app.use('/api', tenantDbMiddleware, authRoutes);
app.use('/api', tenantDbMiddleware, cartRoutes);
app.use('/api', tenantDbMiddleware, paymentRoutes);
app.use('/api', tenantDbMiddleware, adminRoutes);


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});