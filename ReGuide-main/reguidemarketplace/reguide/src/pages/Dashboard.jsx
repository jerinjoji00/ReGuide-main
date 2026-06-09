import {  BookOpen, Upload, Repeat, Bell, User, Mail, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentUserProfile, isAdminProfile } from "../services/userService";
import "./Dashboard.css";

function Dashboard() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      const profile = await getCurrentUserProfile();
      if (!active || !profile) return;

      setDisplayName(profile.name || profile.full_name || profile.email?.split("@")[0] || "");
      setIsAdmin(isAdminProfile(profile));
    })();

    return () => {
      active = false;
    };
  }, []);

  const greeting = `Welcome, ${displayName ? `${displayName}` : ""}`;

  const allCards = [
  {
    title: "Browse Guides",
    description: "Find study materials from top-performing students",
    icon: BookOpen,
    bgColor: "bg-blue",
    path: "/browse",
    adminOnly: false,
  },
  {
    title: "Sell a Guide",
    description: "Monetize your notes and help others succeed",
    icon: Upload,
    bgColor: "bg-purple",
    path: "/sell",
    adminOnly: false,
    hideForAdmin: true,
  },
  {
    title: "My Orders",
    description: "Access your currently active study guides",
    icon: Repeat,
    bgColor: "bg-green",
    path: "/myorders",
  },
  {
    title: "Notifications",
    description: "Stay updated on rentals and new materials",
    icon: Bell,
    bgColor: "bg-orange",
    path: "/notifications",
    adminOnly: false,
  },
  {
    title: "Profile",
    description: "Manage your account and preferences",
    icon: User,
    bgColor: "bg-pink",
    path: "/profile",
    adminOnly: false,
  },
  {
    title: "Contact Support",
    description: "Get help from our support team",
    icon: Mail,
    bgColor: "bg-indigo",
    path: "/contactsupport",
    adminOnly: false,
  },
];

  const cards = allCards.filter(card => !(isAdmin && card.hideForAdmin));

  

  return (
    <div className="main">
          {/* TOP SEARCH */}
          <div className="topbar">
            <input type="text" placeholder="Search guides..." />
          </div>

          <h1>{greeting}</h1>
          <p>What would you like to do today?</p>

          <div className="grid">
            {cards.map((card, index) => {
              const Icon = card.icon;
              return (
                <div key={index} className={`card ${card.bgColor}`}  onClick={() => navigate(card.path)} style={{ cursor: "pointer" }}>
                  <Icon size={56} />
                  
                  {/* TITLE BOX */}
                  <div className="title-box">
                    {card.title}
                  </div>

                  <p>{card.description}</p>
                </div>
              );
            })}
          </div>
        </div>
  
  );
}

export default Dashboard;

