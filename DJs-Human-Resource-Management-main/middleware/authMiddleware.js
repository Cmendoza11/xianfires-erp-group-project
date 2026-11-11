import { User } from "../models/index.js";

// Loads the logged-in user (fresh from MySQL) into req.user and res.locals.
export const attachUser = (req, res, next) => {
  res.locals.currentUser = null;
  res.locals.isAdmin = false;
  res.locals.isStaff = false;
  res.locals.isLimited = false;
  res.locals.currentPath = req.path;
  res.locals.title = "DJs HRMS";

  if (!req.session || !req.session.userId) return next();

  User.findByPk(req.session.userId)
    .then((user) => {
      if (!user) {
        return req.session.destroy(() => next());
      }
      req.user = user;
      res.locals.currentUser = user;
      const role = String(user.role || "employee");
      res.locals.isAdmin = role === "admin";
      res.locals.isStaff = role === "staff";
      res.locals.isLimited = !["admin", "staff"].includes(role);
      next();
    })
    .catch(next);
};

export const requireAuth = (req, res, next) => {
  if (req.user) return next();
  if (req.method === "GET") req.session.returnTo = req.originalUrl;
  req.flash("error_msg", "Please log in to continue.");
  return res.redirect("/login");
};

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      if (req.method === "GET") req.session.returnTo = req.originalUrl;
      req.flash("error_msg", "Please log in to continue.");
      return res.redirect("/login");
    }
    if (roles.includes(String(req.user.role))) return next();
    return res.status(403).render("403", { title: "Access Denied | DJs HRMS" });
  };
