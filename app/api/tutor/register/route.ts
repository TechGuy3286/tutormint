import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Tutor from "@/lib/models/Tutor";

export async function POST(req: Request) {
  try {
    await connectDB();
    const body = await req.json();

    // Check if tutor already exists by email or cnic
    const existingTutor = await Tutor.findOne({
      $or: [{ email: body.email }, { cnic: body.cnic }]
    });

    if (existingTutor) {
      return NextResponse.json(
        { error: "A tutor with this email or CNIC already exists." },
        { status: 400 }
      );
    }

    const newTutor = await Tutor.create({
      ...body,
      status: "pending", // Default status for new applications
    });

    return NextResponse.json(
      { message: "Tutor registered successfully", tutorId: newTutor._id },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Tutor Registration Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}