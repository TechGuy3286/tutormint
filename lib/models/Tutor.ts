import mongoose, { Schema, models } from "mongoose";

const tutorSchema = new Schema(
  {
    // 1. Basic Info & Contact
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    cnic: { type: String, required: true, unique: true },
    phone_number: { type: String },
    whatsapp_number: { type: String },

    // 2. National Location (Pakistan-wide)
    province: { type: String },
    city: { type: String },

    // 3. Teaching Preferences & Academics
    teachingMode: { 
      type: String, 
      enum: ['Physical', 'Online', 'Both'], 
      required: true 
    },
    onlinePlatforms: { type: [String] },
    degrees: { type: [String] }, // Will hold academic qualifications

    // 4. Security & Manual Activation Gate
    status: { 
      type: String, 
      enum: ['pending', 'active', 'suspended'], 
      default: 'pending' // Every new sign-up starts here
    },
    username: { type: String, unique: true, sparse: true }, // Manually assigned later
    password: { type: String }, // Manually assigned later
    is_activation_paid: { type: Boolean, default: false },
    activation_date: { type: Date },

    // 5. The "Connects" Economy
    monthly_connects_quota: { type: Number, default: 0 }, // E.g., drops to 15 when status becomes 'active'
    purchased_connects_balance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const Tutor = models.Tutor || mongoose.model("Tutor", tutorSchema);

export default Tutor;