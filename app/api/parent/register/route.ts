import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Parent from "@/lib/models/Parent";

export async function POST(req: Request) {
  try {
    await connectDB();
    const body = await req.json();

    const newParent = new Parent({
      fullName: body.fullName,
      email: body.email,
      phone_number: body.phone_number,
      city: body.city,
      studentGrade: body.studentGrade,
    });

    await newParent.save();

    return NextResponse.json(
      { message: "Registration successful", parentId: newParent._id },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Parent Registration Error:", error);

    if (error.code === 11000) {
      return NextResponse.json(
        { error: "This email address is already registered." },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to register. Please try again later." },
      { status: 500 }
    );
  }
}