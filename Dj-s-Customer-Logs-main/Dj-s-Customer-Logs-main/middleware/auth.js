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

import { User } from "../models/userModel.js";

/**
 * Loads the logged-in user from the database and attaches to req.user and res.locals
 * This runs on every request to make user data available to views and controllers
 */
export const attachUser = async (req, res, next) => {
  // Initialize default locals
  res.locals.currentUser = null;
  res.locals.isAdmin = false;
  res.locals.isStaff = false;
  res.locals.currentPath = req.path;
  
  // If no session or userId, continue without user
  if (!req.session || !req.session.userId) {
    return next();
  }
  
  try {
    const user = await User.findByPk(req.session.userId);
    
    // If user not found or inactive, destroy session
    if (!user || user.status === "inactive") {
      return req.session.destroy(() => next());
    }
    
    // Attach user to request and locals
    req.user = user;
    res.locals.currentUser = user;
    res.locals.isAdmin = user.role === "admin";
    res.locals.isStaff = user.role === "staff";
    
    next();
  } catch (error) {
    console.error("Error loading user:", error);
    next(error);
  }
};

/**
 * Middleware to require authentication
 * Redirects to login if user is not logged in
 */
export const requireAuth = (req, res, next) => {
  if (req.user && req.user.status === "active") {
    return next();
  }
  
  // Save the original URL to redirect back after login
  if (req.method === "GET") {
    req.session.returnTo = req.originalUrl;
  }
  
  req.flash("error_msg", "Please log in to continue.");
  return res.redirect("/login");
};

/**
 * Middleware to require specific role(s)
 * Usage: requireRole("admin") or requireRole("admin", "staff")
 */
export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    // First check if user is logged in
    if (!req.user) {
      if (req.method === "GET") {
        req.session.returnTo = req.originalUrl;
      }
      req.flash("error_msg", "Please log in to continue.");
      return res.redirect("/login");
    }
    
    // Check if user is active
    if (req.user.status !== "active") {
      req.flash("error_msg", "Your account is inactive. Please contact an administrator.");
      return res.redirect("/login");
    }
    
    // Check if user has required role
    if (allowedRoles.includes(req.user.role)) {
      return next();
    }
    
    // User doesn't have permission
    req.flash("error_msg", "You don't have permission to access this page.");
    
    // Redirect based on their role
    if (req.user.role === "staff") {
      return res.redirect("/staff/dashboard");
    }
    
    return res.redirect("/admin/dashboard");
  };
};

/**
 * Middleware to redirect logged-in users away from login/register pages
 */
export const redirectIfAuthenticated = (req, res, next) => {
  if (req.session && req.session.userId) {
    // Redirect based on role
    if (req.session.role === "admin") {
      return res.redirect("/admin/dashboard");
    }
    return res.redirect("/staff/dashboard");
  }
  next();
};

/**
 * Middleware to protect register page - only accessible when no admin exists
 */
export const allowRegisterOnlyWhenNoAdmin = async (req, res, next) => {
  try {
    // Check if any admin exists
    const adminCount = await User.count({ where: { role: "admin", status: "active" } });
    
    // If no admin exists, allow registration
    if (adminCount === 0) {
      return next();
    }
    
    // If admin exists and user is already authenticated, redirect to dashboard
    if (req.session && req.session.userId) {
      if (req.session.role === "admin") {
        return res.redirect("/admin/dashboard");
      }
      return res.redirect("/staff/dashboard");
    }
    
    // If admin exists but user is not logged in, redirect to login
    req.flash("error_msg", "Registration is disabled. Please contact an administrator for an account.");
    return res.redirect("/login");
    
  } catch (error) {
    console.error("Error checking admin existence:", error);
    next(error);
  }
};
