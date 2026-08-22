import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Tutor from "@/lib/models/Tutor";

// Helper function to turn "Sir Bilal Ahmed" into "sir-bilal-ahmed"
function generateSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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

    // Generate a unique username slug from their full name
    const baseSlug = generateSlug(body.fullName || "tutor");
    let username = baseSlug;
    
    // Ensure slug uniqueness in database if needed
    let counter = 1;
    while (await Tutor.findOne({ username })) {
      username = `${baseSlug}-${counter}`;
      counter++;
    }

    const newTutor = await Tutor.create({
      ...body,
      username, // Save the clean profile handle
      status: "pending", // Default status for new applications
    });

    return NextResponse.json(
      { message: "Tutor registered successfully", tutorId: newTutor._id, username },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Tutor Registration Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}