// backend/services/agreementPdfService.js
const puppeteer = require('puppeteer');
const { cloudinary } = require('../config/cloudinary');
const agreementTemplateService = require('./agreementTemplateService');
const fs = require('fs');
const path = require('path');
const os = require('os');

class AgreementPdfService {

    /**
     * Generate MSA PDF for a partner
     * Returns Cloudinary URL of the uploaded PDF
     */
    async generatePartnerAgreement(partnerData) {
        let browser = null;
        let tempFilePath = null;

        try {
            console.log(`[AGREEMENT] Generating PDF for: ${partnerData.firmName}`);

            // Step 1: Generate HTML
            const html = agreementTemplateService.generatePartnerAgreement(partnerData);

            // Step 2: Launch Puppeteer and generate PDF
            browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ]
            });

            const page = await browser.newPage();
            await page.setContent(html, {
                waitUntil: 'networkidle0',
                timeout: 30000
            });

            // Generate PDF buffer
            const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: {
                    top: '25mm',
                    right: '20mm',
                    bottom: '25mm',
                    left: '20mm'
                },
                displayHeaderFooter: false
            });

            await browser.close();
            browser = null;

            // Step 3: Save temp file (optional fallback/debug)
            const tempDir = os.tmpdir();
            const fileName = `MSA_${partnerData.firmName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.pdf`;
            tempFilePath = path.join(tempDir, fileName);

            fs.writeFileSync(tempFilePath, pdfBuffer);

            // Step 4: Upload to Cloudinary using upload_stream
            const uploadResult = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    {
                        folder: 'syncro1/agreements',
                        resource_type: 'raw',
                        public_id: `MSA_${partnerData.firmName}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, '_'),
                        type: 'upload',
                        access_mode: 'public',
                        format: 'pdf'
                    },
                    (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    }
                );

                uploadStream.end(pdfBuffer);
            });

            // ✅ FIXED: Correct public raw URL
            const pdfUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/raw/upload/${uploadResult.public_id}`;

            // Step 5: Cleanup temp file
            fs.unlinkSync(tempFilePath);
            tempFilePath = null;

            console.log(`[AGREEMENT] ✅ PDF generated and uploaded: ${uploadResult.secure_url}`);

            return {
                success: true,
                url: pdfUrl, // ✅ direct accessible URL
                secureUrl: uploadResult.secure_url,
                publicId: uploadResult.public_id,
                fileName: fileName,
                size: pdfBuffer.length,
                generatedAt: new Date()
            };

        } catch (error) {
            console.error(`[AGREEMENT] ❌ PDF generation failed: ${error.message}`);

            // Cleanup
            if (browser) {
                try { await browser.close(); } catch (e) { }
            }

            if (tempFilePath && fs.existsSync(tempFilePath)) {
                try { fs.unlinkSync(tempFilePath); } catch (e) { }
            }

            throw error;
        }
    }

    /**
     * Generate HTML preview (for frontend to display before signing)
     */
    generatePreview(partnerData) {
        return agreementTemplateService.generatePartnerAgreement(partnerData);
    }
}

module.exports = new AgreementPdfService();