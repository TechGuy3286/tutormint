import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Tutor from "@/lib/models/Tutor";

export async function PATCH(req: Request) {
  try {
    await connectDB();
    const { tutorId, status } = await req.json();

    if (!tutorId || !["approved", "pending"].includes(status)) {
      return NextResponse.json({ error: "Invalid request data" }, { status: 400 });
    }

    const updatedTutor = await Tutor.findByIdAndUpdate(
      tutorId,
      { status },
      { new: true }
    );

    if (!updatedTutor) {
      return NextResponse.json({ error: "Tutor not found" }, { status: 404 });
    }

    return NextResponse.json(
      { message: "Status updated successfully", tutor: updatedTutor },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Update Status Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}