import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx"; // added
import Dashboard from "./pages/Dashboard.jsx";
import Browse from "./pages/Browse.jsx";
import GuideDetail from "./pages/GuideDetail.jsx";
import Checkout from "./pages/Checkout.jsx";
import Chat from "./pages/Chat.jsx";
import AdminDashboard from "./pages/AdminDashboard.jsx";
import AdminModeration from "./pages/AdminModeration.jsx";
import AdminMonitoring from "./pages/AdminMonitoring.jsx";
import AdminUsers from "./pages/AdminUsers.jsx";
import Profile from "./pages/Profile.jsx";
import Notifications from "./pages/Notifications.jsx";
import Contactsupport from "./pages/Contactsupport.jsx";
import Myorders from "./pages/Myorders.jsx";
import Sellguide from "./pages/Sellguide.jsx";
import GuideListing from "./pages/GuideListing.jsx";
import PaymentSuccess from "./pages/PaymentSuccess.jsx";
import Layout from "./components/Layout.jsx";
import UpdatePassword from "./pages/UpdatePassword.jsx";
import Adminsupportinbox from "./pages/Adminsupportinbox";






function App() {
  return (
  
    <BrowserRouter future={{ v7_relativeSplatPath: true }}>
      <Routes>
          {/* keep root for backwards compatibility */}
          <Route path="/" element={<Login />} />
          {/* explicit login route so we can navigate easily */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          {/* password recovery */}
          <Route path="/forgot-password" element={<ForgotPassword />} />

          {/* authenticated layout with sidebar */}
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/guide/:id" element={<GuideDetail />} />
            <Route path="/checkout/:id" element={<Checkout />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/admin-dashboard" element={<AdminDashboard />} />
            <Route path="/admin-moderation" element={<AdminModeration />} />
            <Route path="/admin-monitoring" element={<AdminMonitoring />} />
            <Route path="/admin-users" element={<AdminUsers />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/contactsupport" element={<Contactsupport />} />
            <Route path="/myorders" element={<Myorders />} />
            <Route path="/sell" element={<Sellguide />} />
            <Route path="/guide-listings" element={<GuideListing />} />
            <Route path="/payment-success" element={<PaymentSuccess />} />
            <Route path="/update-password" element={<UpdatePassword />} />
             <Route path="/admin-support" element={<Adminsupportinbox />} />
          </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
