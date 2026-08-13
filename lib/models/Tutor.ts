import mongoose, { Schema, model, models } from "mongoose";

const TutorSchema = new Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    cnic: { type: String, required: true, unique: true },
    
    // Teaching Preferences
    teachingMode: { 
      type: String, 
      enum: ["Physical", "Online", "Both"], 
      required: true 
    },
    preferredApps: [{ 
      type: String, 
      enum: ["WhatsApp", "Zoom", "Google Meet", "Skype", "Other"] 
    }],
    
    // Monetization & Privacy Gates
    badgeTier: { 
      type: String, 
      enum: ["Free", "Verified", "Premium"], 
      default: "Free" 
    },
    
    // Dual-Rating Engine
    ratings: {
      demo: { score: { type: Number, default: 0 }, count: { type: Number, default: 0 } },
      live: { score: { type: Number, default: 0 }, count: { type: Number, default: 0 } }
    }
  },
  { timestamps: true }
);

const Tutor = models.Tutor || model("Tutor", TutorSchema);

export default Tutor;