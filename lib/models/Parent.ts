import mongoose, { Schema, Document } from "mongoose";

export interface IParent extends Document {
  fullName: string;
  email: string;
  phone_number: string;
  city: string;
  studentGrade: string;
  createdAt: Date;
}

const ParentSchema = new Schema<IParent>({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone_number: { type: String, required: true },
  city: { type: String, required: true },
  studentGrade: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.Parent || mongoose.model<IParent>("Parent", ParentSchema);