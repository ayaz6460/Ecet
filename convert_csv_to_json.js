const fs = require('fs');
const path = require('path');

const csvFilePath = path.join(__dirname, 'TGECET_2025_COMPLETE_DATABASE.csv');
const jsonFilePath = path.join(__dirname, 'TGECET_2025_COMPLETE_DATABASE.json');

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            // Check for escaped double quotes inside quotes (e.g., "")
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // skip next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

try {
    console.log(`Reading CSV file from: ${csvFilePath}`);
    const csvContent = fs.readFileSync(csvFilePath, 'utf8');
    const lines = csvContent.split(/\r?\n/);
    
    if (lines.length === 0 || !lines[0].trim()) {
        console.error('CSV file is empty.');
        process.exit(1);
    }
    
    const headers = parseCSVLine(lines[0]);
    console.log('Detected headers:', headers);
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const values = parseCSVLine(line);
        if (values.length !== headers.length) {
            // Skip or log mismatch, but sometimes trailing fields might be empty
            // So let's output a warning if they differ significantly
            if (Math.abs(values.length - headers.length) > 0) {
                console.warn(`Line ${i + 1} field count mismatch: expected ${headers.length}, got ${values.length}. Skipping line: "${line}"`);
                continue;
            }
        }
        
        const row = {};
        for (let j = 0; j < headers.length; j++) {
            let key = headers[j];
            let val = values[j] !== undefined ? values[j] : '';
            
            if (key === 'rank') {
                const parsedRank = parseInt(val, 10);
                row[key] = isNaN(parsedRank) ? 999999 : parsedRank;
            } else {
                row[key] = val;
            }
        }
        data.append ? null : data.push(row); // push to data array
    }
    
    console.log(`Writing ${data.length} records to JSON...`);
    fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Conversion completed successfully! Output: ${jsonFilePath}`);
} catch (err) {
    console.error('An error occurred during conversion:', err);
    process.exit(1);
}
