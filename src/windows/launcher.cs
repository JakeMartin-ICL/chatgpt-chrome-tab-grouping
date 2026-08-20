using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

internal static class ChromeTabGroupingLauncher
{
    private static int Main()
    {
        try
        {
            string executable = Assembly.GetExecutingAssembly().Location;
            string binDirectory = Path.GetDirectoryName(executable);
            string root = Directory.GetParent(binDirectory).FullName;
            string launcherName = Path.GetFileNameWithoutExtension(executable);
            string entrypointName = launcherName.EndsWith("-mcp", StringComparison.OrdinalIgnoreCase)
                ? "mcp.js"
                : "native-host.js";
            string entrypoint = Path.Combine(root, "dist", entrypointName);
            string nodePathFile = Path.Combine(root, ".native-node-path");

            if (!File.Exists(nodePathFile))
            {
                Console.Error.WriteLine("Node.js runtime configuration is missing. Re-run the Chrome Tab Grouping setup.");
                return 1;
            }

            string node = File.ReadAllText(nodePathFile).Trim();
            if (!File.Exists(node) || !File.Exists(entrypoint))
            {
                Console.Error.WriteLine("Chrome Tab Grouping runtime files are missing. Re-run setup.");
                return 1;
            }

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = node,
                Arguments = Quote(entrypoint),
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using (Process child = Process.Start(startInfo))
            {
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Chrome Tab Grouping failed to start: " + error.Message);
            return 1;
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
