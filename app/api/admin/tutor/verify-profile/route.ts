import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Tutor from "@/lib/models/Tutor";

export async function PATCH(req: Request) {
  try {
    await connectDB();
    const { tutorId, profileCompletionStatus } = await req.json();

    if (!tutorId || !profileCompletionStatus) {
      return NextResponse.json({ error: "Missing tutorId or status" }, { status: 400 });
    }

    const tutor = await Tutor.findById(tutorId);
    if (!tutor) {
      return NextResponse.json({ error: "Tutor not found" }, { status: 404 });
    }

    tutor.profileCompletionStatus = profileCompletionStatus; // e.g., 'verified'
    await tutor.save();

    return NextResponse.json(
      { message: "Tutor profile verification status updated successfully", tutor },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Verify Profile Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}