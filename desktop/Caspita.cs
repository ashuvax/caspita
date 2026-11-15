// Caspita.exe: מפעיל קטן (בלי חלון קונסול) שמריץ את launcher.js עם ה-node.exe שמגיע עם ההתקנה.
// נבנה ב-scripts/build-win.js עם csc של .NET Framework (קיים בכל Windows), עם האייקון של האפליקציה.
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Caspita")]
[assembly: System.Reflection.AssemblyProduct("Caspita")]
[assembly: System.Reflection.AssemblyDescription("Caspita")]

static class Program
{
    [STAThread]
    static int Main()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(root, "node", "node.exe");
        string launcher = Path.Combine(root, "app", "desktop", "launcher.js");
        if (!File.Exists(node) || !File.Exists(launcher))
        {
            MessageBox.Show("ההתקנה פגומה — חסרים קבצים. התקן את Caspita מחדש.", "Caspita", MessageBoxButtons.OK, MessageBoxIcon.Error,
                MessageBoxDefaultButton.Button1, MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign);
            return 1;
        }
        var info = new ProcessStartInfo(node, "\"" + launcher + "\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = root,
        };
        Process.Start(info);
        return 0;
    }
}
