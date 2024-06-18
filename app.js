const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const JSZip = require('jszip');
const { JSDOM } = require('jsdom');

// Setup Multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ storage: storage }).array('files[]'); // Use array() instead of single() for 'files[]'

// Serve static files (if needed)
app.use(express.static('public'));

// Route to handle file upload
app.post('/upload-folder', (req, res) => {
    upload(req, res, function(err) {
        if (err) {
            console.error('Multer Error:', err);
            return res.status(500).send('Error uploading files.');
        }

        const uploadedFiles = req.files;
        if (!uploadedFiles || uploadedFiles.length === 0) {
            return res.status(400).send('No files uploaded.');
        }

        const folderPath = path.join(__dirname, 'tmp', 'uploaded'); // Use absolute path

        // Ensure the temporary directory exists
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        try {
            // Save uploaded files to the temporary directory
            uploadedFiles.forEach(uploadedFile => {
                const filePath = path.join(folderPath, uploadedFile.originalname);
                fs.writeFileSync(filePath, uploadedFile.buffer);
            });

            // Process each file (assuming all are JSP files)
            const jspFiles = getAllJSPFiles(folderPath);

            // Modify each JSP file content
            jspFiles.forEach(file => {
                const filePath = path.join("", file);
                let content = fs.readFileSync(filePath, 'utf8');
                // Modify content as needed (replace specific text, remove content, etc.)
                content = convertOnclickToJQuery(content);
                // Write modified content back to the file
                fs.writeFileSync(filePath, content, 'utf8');
            });

            // Create ZIP file and send it to client for download
            const zip = new JSZip();
            addFilesToZip(folderPath, jspFiles, zip);

            // Send the ZIP file to client for download
            zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
                .pipe(res.attachment('modified_folder.zip'))
                .on('finish', function () {
                    console.log('Modified folder ZIP created and sent to client.');
                    // Optionally, you can delete the temporary folder after sending the ZIP file
                    deleteFolderRecursive(folderPath);
                })
                .on('error', function(err) {
                    console.error('ZIP Stream Error:', err);
                    res.status(500).send('Error creating ZIP file.');
                });

        } catch (err) {
            console.error('File Processing Error:', err);
            res.status(500).send('Error processing files.');
        }
    });
});

// Helper function to recursively find all .jsp files in a directory
function getAllJSPFiles(dirPath) {
    let files = [];
    const dirents = fs.readdirSync(dirPath, { withFileTypes: true });
    dirents.forEach(dirent => {
        const fullPath = path.join(dirPath, dirent.name);
        if (dirent.isDirectory()) {
            files = files.concat(getAllJSPFiles(fullPath));
        } else if (dirent.isFile() && dirent.name.endsWith('.jsp')) {
            files.push(fullPath);
        }
    });
    return files;
}

// Function to convert onclick to jQuery
function convertOnclickToJQuery(content) {
    const dom = new JSDOM(content, { contentType: "text/html" });
    const document = dom.window.document;
    const elements = document.querySelectorAll('[onclick]');

    const script = document.createElement('script');
    script.textContent = `\n
    $(document).ready(function() {
        $(document).on('click', 'a[href="javascript:void(0);"]', function(event) {
            event.preventDefault();
        });
    `;
    const eventAttributes = ['onclick', 'onchange', 'onerror', 'onload'];
    eventAttributes.forEach(attribute => {
        const elements = document.querySelectorAll(`[${attribute}]`);

        elements.forEach(function (element) {
            const eventContent = element.getAttribute(attribute);
            element.removeAttribute(attribute);

            var uniqueClass = 'convert-' + attribute.substring(2) + '-' + Math.random().toString(36).substr(2, 9);
            element.classList.add(uniqueClass);

            const params = extractParams(eventContent);
            params.forEach(function (param, index) {
                element.setAttribute('data-param' + (index + 1), param.trim().replace(/'/g, ''));
            });
            const functionName = extractFunctionName(eventContent);

            script.textContent += `             
        $(document).on('click', '.${uniqueClass}', function(event) {
            event.preventDefault();
            ${params.map((param, index) => `
            var key${index + 1} = $(this).data('param${index + 1}');
            `).join('\n')}
            ${functionName.toString()}(${params.map((param, index) => `key${index + 1}`).join(', ')});
        });
    `;
        });
    })
    script.textContent += `
        });
    `;

    script.setAttribute('nonce', '${nonce}');
    script.setAttribute('type', 'text/javascript');

    document.body.appendChild(script);

    let serializedContent = dom.serialize();
    serializedContent = serializedContent
        .replace(/<html[^>]*>/, '')
        .replace(/<\/html>/, '')
        .replace(/<head[^>]*>/, '')
        .replace(/<\/head>/, '')
        .replace(/<body[^>]*>/, '')
        .replace(/<\/body>/, '')
        .replace(/&lt;\/body&gt;/g, '</body>')
        .replace(/&lt;\/html&gt;/g, '</html>')
        .replace(/&lt;%@/g, '<%@')
        .replace(/%&gt;/g, '%>')
        .replace(/&lt;%/g, '<%')
        .replace(/&gt;/g, '</c:if>>');

    return serializedContent;
}

function extractFunctionName(onclickContent) {
    return onclickContent.substring(0, onclickContent.indexOf('(')).trim();
}

function extractParams(onclickContent) {
    const paramString = onclickContent.substring(onclickContent.indexOf('(') + 1, onclickContent.lastIndexOf(')')).trim();
    if (!paramString) return [];
    const params = paramString.split(',').map(param => param.trim());
    return params;
}

// Function to add files to ZIP
function addFilesToZip(folderPath, files, zip) {
    files.forEach(file => {
        const filePath = path.join("", file);
        const fileContent = fs.readFileSync(filePath);
        const relativePath = path.relative(folderPath, filePath);
        zip.file(relativePath, fileContent);
    });
}

// Function to delete a folder recursively
function deleteFolderRecursive(folderPath) {
    if (fs.existsSync(folderPath)) {
        fs.readdirSync(folderPath).forEach((file, index) => {
            const curPath = path.join(folderPath, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                deleteFolderRecursive(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(folderPath);
    }
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
