import mongoose, { Schema, Document } from "mongoose";

export interface ITuitionJob extends Document {
  parentId: mongoose.Types.ObjectId;
  parentEmail: string;
  title: string;
  subjects: string[];
  classLevel: string;
  city: string;
  province: string;
  teachingMode: 'Physical' | 'Online' | 'Both';
  budget: string;
  description: string;
  status: 'active' | 'closed';
  applicants: {
    tutorId: mongoose.Types.ObjectId;
    tutorName: string;
    tutorEmail: string;
    connectsSpent: number;
    appliedAt: Date;
  }[];
  createdAt: Date;
}

const TuitionJobSchema: Schema = new Schema({
  parentId: { type: Schema.Types.ObjectId, ref: "Parent" },
  parentEmail: { type: String, required: true },
  title: { type: String, required: true },
  subjects: { type: [String], required: true },
  classLevel: { type: String, required: true },
  city: { type: String, required: true },
  province: { type: String, required: true },
  teachingMode: { type: String, enum: ['Physical', 'Online', 'Both'], required: true },
  budget: { type: String, required: true },
  description: { type: String, required: true },
  status: { type: String, enum: ['active', 'closed'], default: 'active' },
  applicants: [{
    tutorId: { type: Schema.Types.ObjectId, ref: "Tutor" },
    tutorName: String,
    tutorEmail: String,
    connectsSpent: { type: Number, default: 3 }, // Cost per job application
    appliedAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

export default mongoose.models.TuitionJob || mongoose.model<ITuitionJob>("TuitionJob", TuitionJobSchema);