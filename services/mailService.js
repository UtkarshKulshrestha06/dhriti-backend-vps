const { Resend } = require("resend");

/**
 * Mail Service for Dhriti Classes
 * Uses Resend HTTP API (replaces nodemailer SMTP which is blocked on Render free tier)
 */
const resend = new Resend(process.env.RESEND_API_KEY || "re_dummy");

/**
 * Send Contact Inquiry Notification to Admin
 */
const sendInquiryNotification = async (inquiry) => {
    const { name, email, phone, message, batchInterest } = inquiry;
    const adminEmail = process.env.CONTACT_EMAIL || "enquiry@dhriticlasses.com";
    const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

    try {
        const { data, error } = await resend.emails.send({
            from: `Dhriti Classes Website <${fromEmail}>`,
            to: [adminEmail],
            subject: `New Website Inquiry: ${name}`,
            html: `
                <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                    <h2 style="color: #4f46e5; border-bottom: 2px solid #f3f4f6; padding-bottom: 10px;">New Website Inquiry</h2>
                    
                    <p>Hello Admin,</p>
                    <p>You have received a new message from the website contact form.</p>
                    
                    <div style="background-color: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p><strong>Name:</strong> ${name}</p>
                        <p><strong>Email:</strong> ${email || 'Not provided'}</p>
                        <p><strong>Phone:</strong> ${phone}</p>
                        <p><strong>Interested In:</strong> ${batchInterest || 'General'}</p>
                    </div>
                    
                    <div style="padding: 15px; border-left: 4px solid #4f46e5; background-color: #fff;">
                        <strong>Message:</strong><br/>
                        <p>${message || 'No message provided.'}</p>
                    </div>
                    
                    <p style="margin-top: 25px; font-size: 12px; color: #9ca3af;">
                        This is an automated notification from Dhriti Classes Backend.
                    </p>
                </div>
            `,
        });

        if (error) {
            console.error("Resend API error:", error);
            return { success: false, error: error.message };
        }

        console.log("Email sent successfully via Resend:", data.id);
        return { success: true, messageId: data.id };
    } catch (error) {
        console.error("Error sending email:", error);
        return { success: false, error: error.message };
    }
};

module.exports = {
    sendInquiryNotification,
};
