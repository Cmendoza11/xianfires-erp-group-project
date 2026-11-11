
      /*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
    
import bcrypt from "bcrypt";
import { User } from "../models/userModel.js";

export const loginPage = (req, res) => {
    res.render("login", { 
        title: "Login",
        errorMessage: req.session.error 
    });
    delete req.session.error;
};

export const registerPage = (req, res) => res.render("register", { title: "Register" });

export const forgotPasswordPage = (req, res) => res.render("forgotpassword", { title: "Forgot Password" });

export const dashboardPage = (req, res) => {
    if (!req.session.userId) return res.redirect("/login");
    res.redirect("/suppliers"); // Ire-redirect sa Supplier Dashboard
};

export const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ where: { email } });
        
        if (!user) {
            req.session.error = "User not found";
            return res.redirect("/login");
        }
        
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            req.session.error = "Incorrect password";
            return res.redirect("/login");
        }
        
        req.session.userId = user.id;
        req.session.user = {
            id: user.id,
            name: user.name || "System Administrator",
            email: user.email
        };

        res.redirect("/suppliers");
    } catch (error) {
        console.error("Login Error:", error);
        req.session.error = "Something went wrong during login.";
        res.redirect("/login");
    }
};

export const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const hashed = await bcrypt.hash(password, 10);
        const user = await User.create({ name, email, password: hashed });
        
        req.session.userId = user.id;
        req.session.user = {
            id: user.id,
            name: user.name,
            email: user.email
        };

        res.redirect("/suppliers");
    } catch (error) {
        console.error("Register Error:", error);
        res.redirect("/register");
    }
};

export const logoutUser = (req, res) => {
    req.session.destroy(() => {
        res.redirect("/login");
    });
};