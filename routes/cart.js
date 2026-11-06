const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// Add or update cart item
router.post('/cart', async (req, res) => {
    try {
        const { username, productId, quantity } = req.body;
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('username', username)
            .single();

        if (userError || !user) return res.status(404).json({ message: "User not found" });

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

// Get user's cart
router.get('/cart/user/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('username', username)
            .single();

        if (userError || !user) return res.status(404).json({ message: "User not found" });

        const { data: cartItems, error } = await supabase
            .from('cart')
            .select(`id, quantity, products (name, price, image_url)`)
            .eq('user_id', user.id);

        if (error) throw error;

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

// Get total item count in cart
router.get('/cart/count/:username', async (req, res) => {
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

// Delete cart item
router.delete('/cart/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('cart').delete().eq('id', id);
        if (error) throw error;
        res.json({ message: "Item removed from cart" });
    } catch (err) {
        console.error("Cart Route Error:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
});

// Update cart quantity (+ / -)
router.put('/cart/update-quantity/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { change } = req.body;
        
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

module.exports = router;