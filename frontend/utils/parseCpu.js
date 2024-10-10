export default function parseCpu(value) {
    if (!value) return 0;

    // Check if the last character is a digit
    const isLastCharDigit = !isNaN(value.slice(-1));
    const numberStr = isLastCharDigit ? value : value.slice(0, -1);  // Extract number part
    const unit = isLastCharDigit ? '' : value.slice(-1);             // Extract unit

    const number = parseFloat(numberStr);  // Convert number to float
    console.log("ParseCPU:", numberStr, number, unit); // Debugging output

    // Handle potential errors
    if (isNaN(number)) {
        console.warn("Invalid CPU value:", value);
        return 0;
    }

    switch (unit) {
        case 'n': return number / 1000000000;
        case 'u': return number / 1000000;
        case 'm': return number / 1000;
        default: return number; // Assume cores
    }
}