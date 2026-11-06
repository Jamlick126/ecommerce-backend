const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

// Middleware to verify JWT token for admin routes
const verifyAdminToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
        return res.status(403).json({ message: "No token provided" });
    }

    try {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "My_secret_key");
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: "Unauthorized: Invalid token" });
    }
};

// GET all orders for the admin dashboard (Protected by JWT)
router.get('/admin/orders', verifyAdminToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error("Admin Orders Error:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
});

// PUT update order status manually (Protected by JWT)
router.put('/admin/orders/:id/status', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // e.g., 'paid' or 'failed'

        if (!['pending', 'paid', 'failed'].includes(status)) {
            return res.status(400).json({ message: "Invalid status value provided" });
        }

        const { data, error } = await supabase
            .from('orders')
            .update({ status })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Order not found" });

        res.json({ message: "Order status updated successfully", order: data });
    } catch (err) {
        console.error("Update Order Status Error:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
});

module.exports = router;