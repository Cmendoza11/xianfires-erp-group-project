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

// Helper functions
const cleanEmail = (value) => String(value || "").trim().toLowerCase();
const cleanText = (value) => String(value || "").trim();
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * Start a new session for the user
 */
const startSession = (req, user) => {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.save((saveErr) => {
        if (saveErr) return reject(saveErr);
        resolve();
      });
    });
  });
};

// ==================== UNIFIED LOGIN ====================

export const loginPage = (req, res) => {
  if (req.session.userId) {
    // Redirect based on role if already logged in
    return res.redirect(req.session.role === "admin" ? "/admin/dashboard" : "/staff/dashboard");
  }
  
  res.render("login", { 
    title: "Login | Customer Logs",
    layout: false
  });
};

export const loginUser = async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || "");

    // Validation
    if (!email || !password) {
      req.flash("error_msg", "Email and password are required.");
      return res.redirect("/login");
    }

    if (!isValidEmail(email)) {
      req.flash("error_msg", "Please enter a valid email address.");
      return res.redirect("/login");
    }

    // Find user
    const user = await User.findOne({ where: { email } });
    
    if (!user) {
      req.flash("error_msg", "Invalid email or password.");
      return res.redirect("/login");
    }

    // Check if account is active
    if (user.status !== "active") {
      req.flash("error_msg", "Your account is inactive. Please contact an administrator.");
      return res.redirect("/login");
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      req.flash("error_msg", "Invalid email or password.");
      return res.redirect("/login");
    }

    // Update last login
    await user.update({ lastLoginAt: new Date() });

    // Create session
    await startSession(req, user);

    // Redirect based on role
    const returnTo = req.session.returnTo;
    delete req.session.returnTo;
    
    req.flash("success_msg", `Welcome back, ${user.name}!`);
    
    if (returnTo && (returnTo.startsWith("/staff") || returnTo.startsWith("/admin"))) {
      return res.redirect(returnTo);
    }
    
    // Default redirect based on role
    res.redirect(user.role === "admin" ? "/admin/dashboard" : "/staff/dashboard");

  } catch (error) {
    console.error("Login error:", error);
    req.flash("error_msg", "An error occurred during login. Please try again.");
    res.redirect("/login");
  }
};

// ==================== FORGOT PASSWORD ====================

export const forgotPasswordPage = (req, res) => {
  res.render("forgotpassword", { 
    title: "Forgot Password | Customer Logs",
    layout: false 
  });
};

// ==================== LOGOUT ====================

export const logoutUser = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
    }
    res.clearCookie("xf_crm.sid");
    res.redirect("/login");
  });
};
