const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// Public route to fetch store branding/config from Master DB
router.get('/store-config/:slug', async (req, res) => {
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

// Fetch all products
router.get('/products', async (req, res) => {
    try {
        const { data, error } = await supabase.from('products').select('*');
        if (error) return res.status(500).json({ message: error.message });
        res.json(data);
    } catch (err) {
        console.error("Products Route Error:", err.message);
        res.status(500).send('Server Error');
    }
});

// Fetch single product by ID
router.get('/products/:id', async (req, res) => {
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

module.exports = router;