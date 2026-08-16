import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Tutor from "@/lib/models/Tutor";

export async function PATCH(req: Request) {
  try {
    await connectDB();
    const { email, introVideo, degreeProof, activityLog } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const tutor = await Tutor.findOne({ email });
    if (!tutor) {
      return NextResponse.json({ error: "Tutor not found" }, { status: 404 });
    }

    // Update profile completion fields
    if (introVideo !== undefined) tutor.introVideo = introVideo;
    if (degreeProof) tutor.verificationDocuments = [degreeProof];

    // If both intro video and degree are provided, flag as pending final verification
    if (tutor.introVideo && tutor.verificationDocuments.length > 0) {
      tutor.profileCompletionStatus = "pending_verification";
    }

    // Push to activity log if activity data is passed
    if (activityLog) {
      tutor.connectsHistory.push({
        amount: activityLog.amount || 0,
        type: activityLog.type || "bonus",
        description: activityLog.description || "Platform activity logged",
        createdAt: new Date()
      });
    }

    await tutor.save();

    return NextResponse.json(
      { message: "Profile updated successfully", tutor },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Complete Profile Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}