import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Tutor from "@/lib/models/Tutor";

export async function POST(req: Request) {
  try {
    // 1. Connect to the database
    await connectDB();

    // 2. Parse the incoming form data
    const body = await req.json();

    // 3. Create a new Tutor document based on our updated schema
    const newTutor = new Tutor({
      fullName: body.fullName,
      email: body.email,
      cnic: body.cnic,
      phone_number: body.phone_number,
      whatsapp_number: body.whatsapp_number,
      province: body.province,
      city: body.city,
      degrees: body.degrees,
      teachingMode: body.teachingMode,
      onlinePlatforms: body.onlinePlatforms,
      // status defaults to 'pending'
      // connects and balances default to 0
    });

    // 4. Save to MongoDB
    await newTutor.save();

    // 5. Send success response back to the frontend
    return NextResponse.json(
      { message: "Tutor application received successfully", tutorId: newTutor._id },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Registration Error:", error);

    // Handle MongoDB duplicate key errors (e.g., someone reusing an email or CNIC)
    if (error.code === 11000) {
      const duplicateField = Object.keys(error.keyValue)[0];
      return NextResponse.json(
        { error: `This ${duplicateField} is already registered.` },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to submit application. Please try again later." },
      { status: 500 }
    );
  }
}