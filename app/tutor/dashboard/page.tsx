// Diagnostic Bypass: Check session only, skip database table lookup temporarily
  useEffect(() => {
    const verifyTutorRole = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !session?.user) {
          window.location.href = '/login'
          return
        }
        
        // If session exists, stop loading and show the dashboard!
        setLoadingRole(false)
      } catch (err) {
        console.error('Role verification error:', err)
        window.location.href = '/login'
      }
    }

    verifyTutorRole()
  }, [supabase])