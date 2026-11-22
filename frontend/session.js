
/* ==========================================
CCMC RETAILFLOW – SESSION MANAGEMENT
Step 8.9.2: Session Checking
========================================== */

document.addEventListener("DOMContentLoaded", async function () {

    const loginPage = "/frontend/index.html";

    // Determine which dashboard is being accessed
    const currentPage = window.location.pathname;

    let requiredRole = null;


    if (currentPage.endsWith("/owner-dashboard.html")) {

            requiredRole = "Owner";

        } else if (currentPage.endsWith("/staff-dashboard.html")) {

            requiredRole = "Staff";

        } else if (currentPage.endsWith("/users/users.html")) {

            // User Accounts is accessible to Owner only
            requiredRole = "Owner";

        } else {

            return;

        }


        // Hide protected content while session is checked
        document.body.style.visibility = "hidden";

        try {

            const response = await fetch("/api/auth/me", {
                method: "GET",
                credentials: "same-origin",
                cache: "no-store"
        });

        if (!response.ok) {
                window.location.replace(loginPage);
                return;
            }

            const data = await response.json();

            if (
                    !data.success ||
                    !data.user ||
                    data.user.role !== requiredRole
                ) {
                    window.location.replace(loginPage);
                    return;
                }

                // Session confirmed
                document.body.style.visibility = "visible";


                /* ==========================================
                STEP 8.9.3 – LOGOUT FUNCTIONALITY
                ========================================== */

                const logoutBtn = document.getElementById("logoutBtn");

                if (logoutBtn) {

                        logoutBtn.addEventListener("click", async function () {

                            logoutBtn.disabled = true;
                            logoutBtn.textContent = "Logging out...";

                            try {

                                const response = await fetch("/api/auth/logout", {
                                    method: "POST",
                                    credentials: "same-origin"
                            });

                            if (!response.ok) {
                                    throw new Error("Logout request failed.");
                                }

                                // Return to login page
                                window.location.replace(
                                    "/frontend/index.html"
                                );

                            } catch (error) {

                                console.error("Logout failed:", error);

                                alert("Unable to log out. Please try again.");

                                logoutBtn.disabled = false;
                                logoutBtn.textContent = "Logout";
                            }

                    });

                }


                console.log(
                    `Authenticated ${data.user.role}: ${data.user.username}`
                );

            } catch (error) {

                console.error("Session verification failed:", error);

                window.location.replace(loginPage);
            }

    });
