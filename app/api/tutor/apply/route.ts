import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Tutor from "@/lib/models/Tutor";
import TuitionJob from "@/lib/models/TuitionJob";
import ActivityLog from "@/lib/models/ActivityLog";

export async function POST(req: Request) {
  try {
    await connectDB();
    const { tutorEmail, jobId } = await req.json();

    if (!tutorEmail || !jobId) {
      return NextResponse.json({ error: "Tutor email and job ID are required" }, { status: 400 });
    }

    // 1. Fetch Tutor
    const tutor = await Tutor.findOne({ email: tutorEmail });
    if (!tutor) {
      return NextResponse.json({ error: "Tutor not found" }, { status: 404 });
    }

    // 2. Enforce Verification Guardrail
    if (tutor.profileCompletionStatus !== "verified") {
      return NextResponse.json(
        { error: "Your profile must be 100% verified by admin before applying to tuition jobs." },
        { status: 403 }
      );
    }

    // 3. Enforce Connects Balance (e.g., 3 connects required per application)
    const REQUIRED_CONNECTS = 3;
    if (tutor.connectsBalance < REQUIRED_CONNECTS) {
      return NextResponse.json(
        { error: `Insufficient connects. You need at least ${REQUIRED_CONNECTS} connects to apply. Balance: ${tutor.connectsBalance}` },
        { status: 400 }
      );
    }

    // 4. Fetch Job
    const job = await TuitionJob.findById(jobId);
    if (!job || job.status !== "active") {
      return NextResponse.json({ error: "Tuition job not found or closed" }, { status: 404 });
    }

    // Check if already applied
    const alreadyApplied = job.applicants.some((app: any) => app.tutorId.toString() === tutor._id.toString());
    if (alreadyApplied) {
      return NextResponse.json({ error: "You have already applied to this tuition job." }, { status: 400 });
    }

    // 5. Deduct Connects & Save History
    tutor.connectsBalance -= REQUIRED_CONNECTS;
    tutor.connectsHistory.push({
      amount: -REQUIRED_CONNECTS,
      type: "deduction",
      description: `Applied to tuition job: ${job.title}`,
      createdAt: new Date()
    });
    await tutor.save();

    // 6. Record Application on Job
    job.applicants.push({
      tutorId: tutor._id,
      tutorName: tutor.fullName,
      tutorEmail: tutor.email,
      connectsSpent: REQUIRED_CONNECTS,
      appliedAt: new Date()
    });
    await job.save();

    // 7. Log Activity
    await ActivityLog.create({
      tutorId: tutor._id,
      action: "APPLY_JOB",
      description: `Applied to job "${job.title}" and spent ${REQUIRED_CONNECTS} connects.`,
      metadata: { jobId, connectsSpent: REQUIRED_CONNECTS }
    });

    return NextResponse.json({ 
      message: "Successfully applied to tuition job!", 
      remainingConnects: tutor.connectsBalance 
    }, { status: 200 });

  } catch (error: any) {
    console.error("Job Application Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}