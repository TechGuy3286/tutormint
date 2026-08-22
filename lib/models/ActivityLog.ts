import mongoose, { Schema, Document } from "mongoose";

export interface IActivityLog extends Document {
  tutorId: mongoose.Types.ObjectId;
  action: string; // e.g., 'VISIT_JOB_PAGE', 'VIEW_CONTACT', 'APPLY_JOB', 'COMPLETE_PROFILE'
  description: string;
  metadata?: any;
  createdAt: Date;
}

const ActivityLogSchema: Schema = new Schema({
  tutorId: { type: Schema.Types.ObjectId, ref: "Tutor", required: true },
  action: { type: String, required: true },
  description: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed },
}, { timestamps: { createdAt: true, updatedAt: false } });

export default mongoose.models.ActivityLog || mongoose.model<IActivityLog>("ActivityLog", ActivityLogSchema);