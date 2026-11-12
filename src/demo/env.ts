// נטען לפני כל השאר — קובע מסד נתונים נפרד ופורט נפרד להדגמה, כדי לא לגעת בנתונים האמיתיים
process.env.DEMO = 'true';
process.env.CASPITA_DB = process.env.CASPITA_DB || 'caspita-demo.db';
process.env.PORT = process.env.DEMO_PORT || '3001';
if (process.argv.includes('--reset')) process.env.DEMO_RESET = 'true';
