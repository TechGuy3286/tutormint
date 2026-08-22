import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Tutor from "@/lib/models/Tutor";

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

    // Generate clean profile username slug
    const baseSlug = generateSlug(body.fullName || "tutor");
    let username = baseSlug;
    let counter = 1;
    while (await Tutor.findOne({ username })) {
      username = `${baseSlug}-${counter}`;
      counter++;
    }

    // Convert comma-separated degrees string into an array of strings
    const degreesArray = body.degrees 
      ? body.degrees.split(',').map((d: string) => d.trim()).filter(Boolean) 
      : [];

    const newTutor = await Tutor.create({
      ...body,
      degrees: degreesArray,
      username,
      monthly_connects_quota: 15, // Allocating the 15 bonus credits mentioned on signup
      status: "pending", 
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