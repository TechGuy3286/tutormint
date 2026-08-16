import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import TuitionJob from "@/lib/models/TuitionJob";

// GET: Fetch all active tuition jobs for tutors to browse
export async function GET(req: Request) {
  try {
    await connectDB();
    const jobs = await TuitionJob.find({ status: "active" }).sort({ createdAt: -1 });
    return NextResponse.json({ jobs }, { status: 200 });
  } catch (error: any) {
    console.error("Fetch Jobs Error:", error);
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
  }
}

// POST: Parent posts a new tuition job
export async function POST(req: Request) {
  try {
    await connectDB();
    const { parentEmail, title, subjects, classLevel, city, province, teachingMode, budget, description } = await req.json();

    if (!parentEmail || !title || !subjects || !classLevel || !city || !province || !teachingMode || !budget || !description) {
      return NextResponse.json({ error: "All job fields are required" }, { status: 400 });
    }

    const job = await TuitionJob.create({
      parentEmail,
      title,
      subjects: Array.isArray(subjects) ? subjects : subjects.split(",").map((s: string) => s.trim()),
      classLevel,
      city,
      province,
      teachingMode,
      budget,
      description,
      status: "active",
      applicants: []
    });

    return NextResponse.json({ message: "Tuition job posted successfully!", job }, { status: 201 });
  } catch (error: any) {
    console.error("Post Job Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}