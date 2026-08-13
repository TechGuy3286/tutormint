import { NextResponse } from "next/server";
import connectToDatabase from "../../../../lib/mongodb";
import Tutor from "../../../../lib/models/Tutor";

export async function POST(req: Request) {
  try {
    // 1. Connect to MongoDB
    await connectToDatabase();
    
    // 2. Grab the data sent from the frontend form
    const body = await req.json();

    // 3. Save it to the database using our Schema
    const newTutor = await Tutor.create(body);

    // 4. Send a success message back to the frontend
    return NextResponse.json(
      { message: "Tutor registered successfully!", tutor: newTutor },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Database Error:", error);
    
    // Handle duplicate Email or CNIC (MongoDB throws code 11000 for unique field clashes)
    if (error.code === 11000) {
      return NextResponse.json(
        { error: "A tutor with this email or CNIC already exists in the system." },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: "Failed to register tutor. Please try again." },
      { status: 500 }
    );
  }
}